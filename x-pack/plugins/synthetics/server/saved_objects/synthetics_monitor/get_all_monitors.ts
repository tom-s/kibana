/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  SavedObjectsClientContract,
  SavedObjectsFindOptions,
  SavedObjectsFindResult,
} from '@kbn/core-saved-objects-api-server';
import pMap from 'p-map';
import { periodToMs } from '../../routes/status/current_status';
import { UptimeServerSetup } from '../../legacy_uptime/lib/adapters';
import { getAllLocations } from '../../synthetics_service/get_all_locations';
import { syntheticsMonitorType } from '../../legacy_uptime/lib/saved_objects/synthetics_monitor';
import {
  ConfigKey,
  EncryptedSyntheticsMonitor,
  ServiceLocation,
  SourceType,
} from '../../../common/runtime_types';
import { SyntheticsMonitorClient } from '../../synthetics_service/synthetics_monitor/synthetics_monitor_client';

export const getAllMonitors = async ({
  soClient,
  search,
  fields,
  sortField,
  sortOrder,
}: {
  soClient: SavedObjectsClientContract;
  search?: string;
} & Pick<SavedObjectsFindOptions, 'sortField' | 'sortOrder' | 'fields'>) => {
  const finder = soClient.createPointInTimeFinder({
    type: syntheticsMonitorType,
    perPage: 1000,
    search,
    sortField,
    sortOrder,
    fields,
  });

  const hits: Array<SavedObjectsFindResult<EncryptedSyntheticsMonitor>> = [];
  for await (const result of finder.find()) {
    hits.push(
      ...(result.saved_objects as Array<SavedObjectsFindResult<EncryptedSyntheticsMonitor>>)
    );
  }

  // no need to wait for it
  finder.close();

  return hits;
};

export const processMonitors = async (
  allMonitors: Array<SavedObjectsFindResult<EncryptedSyntheticsMonitor>>,
  server: UptimeServerSetup,
  soClient: SavedObjectsClientContract,
  syntheticsMonitorClient: SyntheticsMonitorClient
) => {
  /**
   * Walk through all monitor saved objects, bucket IDs by disabled/enabled status.
   *
   * Track max period to make sure the snapshot query should reach back far enough to catch
   * latest ping for all enabled monitors.
   */

  const enabledIds: string[] = [];
  let disabledCount = 0;
  let disabledMonitorsCount = 0;
  let maxPeriod = 0;
  let projectMonitorsCount = 0;
  const allIds: string[] = [];
  let listOfLocationsSet = new Set<string>();
  const monitorLocationMap: Record<string, string[]> = {};

  let allLocations: ServiceLocation[] | null = null;

  const getLocationLabel = async (locationId: string) => {
    if (!allLocations) {
      const { publicLocations, privateLocations } = await getAllLocations(
        server,
        syntheticsMonitorClient,
        soClient
      );

      allLocations = [...publicLocations, ...privateLocations];
    }

    return allLocations.find((loc) => loc.id === locationId)?.label ?? locationId;
  };

  for (const monitor of allMonitors) {
    const attrs = monitor.attributes;

    allIds.push(attrs[ConfigKey.MONITOR_QUERY_ID]);

    projectMonitorsCount += attrs?.[ConfigKey.MONITOR_SOURCE_TYPE] === SourceType.PROJECT ? 1 : 0;

    if (attrs[ConfigKey.ENABLED] === false) {
      disabledCount += attrs[ConfigKey.LOCATIONS].length;
      disabledMonitorsCount += 1;
    } else {
      const missingLabels = new Set<string>();

      enabledIds.push(attrs[ConfigKey.MONITOR_QUERY_ID]);
      const monLocs = new Set([
        ...(attrs[ConfigKey.LOCATIONS]
          .filter((loc) => {
            if (!loc.label) {
              missingLabels.add(loc.id);
            }
            return loc.label;
          })
          .map((location) => location.label) as string[]),
      ]);

      // since label wasn't always part of location, there can be a case where we have a location
      // with an id but no label. We need to fetch the label from the API
      // Adding a migration to add the label to the saved object is a future consideration
      const locLabels = await pMap([...missingLabels], async (locationId) =>
        getLocationLabel(locationId)
      );

      monitorLocationMap[attrs[ConfigKey.MONITOR_QUERY_ID]] = [...monLocs, ...locLabels];
      listOfLocationsSet = new Set([...listOfLocationsSet, ...monLocs, ...locLabels]);

      maxPeriod = Math.max(maxPeriod, periodToMs(attrs[ConfigKey.SCHEDULE]));
    }
  }

  return {
    maxPeriod,
    allIds,
    enabledIds,
    disabledCount,
    monitorLocationMap,
    disabledMonitorsCount,
    projectMonitorsCount,
    listOfLocations: [...listOfLocationsSet],
  };
};
