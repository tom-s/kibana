/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { act, renderHook } from '@testing-library/react-hooks';
import { makeAction, makeActionContext } from '../mocks/helpers';
import { useBulkLoadActions, useLoadActions, useLoadActionsFn } from './use_load_actions';

const action = makeAction('action-1', 'icon', 1);
const mockGetActions = jest.fn(async () => [action]);
jest.mock('../context/cell_actions_context', () => ({
  useCellActionsContext: () => ({ getActions: mockGetActions }),
}));

describe('useLoadActions', () => {
  const actionContext = makeActionContext();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads actions when useLoadActions called', async () => {
    const { result, waitForNextUpdate } = renderHook(useLoadActions, {
      initialProps: actionContext,
    });

    expect(result.current.value).toBeUndefined();
    expect(result.current.loading).toEqual(true);
    expect(mockGetActions).toHaveBeenCalledTimes(1);
    expect(mockGetActions).toHaveBeenCalledWith(actionContext);

    await waitForNextUpdate();

    expect(result.current.value).toEqual([action]);
    expect(result.current.loading).toEqual(false);
  });

  it('loads actions when useLoadActionsFn function is called', async () => {
    const { result, waitForNextUpdate } = renderHook(useLoadActionsFn);
    const [{ value: valueBeforeCall, loading: loadingBeforeCall }, loadActions] = result.current;

    expect(valueBeforeCall).toBeUndefined();
    expect(loadingBeforeCall).toEqual(false);
    expect(mockGetActions).not.toHaveBeenCalled();

    act(() => {
      loadActions(actionContext);
    });

    const [{ value: valueAfterCall, loading: loadingAfterCall }] = result.current;
    expect(valueAfterCall).toBeUndefined();
    expect(loadingAfterCall).toEqual(true);
    expect(mockGetActions).toHaveBeenCalledTimes(1);
    expect(mockGetActions).toHaveBeenCalledWith(actionContext);

    await waitForNextUpdate();

    const [{ value: valueAfterUpdate, loading: loadingAfterUpdate }] = result.current;
    expect(valueAfterUpdate).toEqual([action]);
    expect(loadingAfterUpdate).toEqual(false);
  });

  it('loads bulk actions array when useBulkLoadActions is called', async () => {
    const actionContext2 = makeActionContext({ trigger: { id: 'triggerId2' } });
    const actionContexts = [actionContext, actionContext2];
    const { result, waitForNextUpdate } = renderHook(useBulkLoadActions, {
      initialProps: actionContexts,
    });

    expect(result.current.value).toBeUndefined();
    expect(result.current.loading).toEqual(true);
    expect(mockGetActions).toHaveBeenCalledTimes(2);
    expect(mockGetActions).toHaveBeenCalledWith(actionContext);
    expect(mockGetActions).toHaveBeenCalledWith(actionContext2);

    await waitForNextUpdate();

    expect(result.current.value).toEqual([[action], [action]]);
    expect(result.current.loading).toEqual(false);
  });
});
