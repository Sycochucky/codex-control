import test = require("node:test");
import assert = require("node:assert/strict");

import {
  beginThreadPageRequest,
  completeThreadPageRequest,
  createThreadPagingState,
  failThreadPageRequest,
  getNextThreadPageRequest,
  getPreviousThreadPageRequest,
  THREAD_PAGE_SIZE_OPTIONS,
} from "../utils/thread-paging";

test("thread paging defaults to 25 with supported page-size options", () => {
  const state = createThreadPagingState<string>();

  assert.deepEqual(THREAD_PAGE_SIZE_OPTIONS, [10, 25, 50]);
  assert.equal(state.pageSize, 25);
  assert.deepEqual(state.pageCursors, [null]);
});

test("thread paging ignores stale responses and keeps the latest request loading", () => {
  let state = createThreadPagingState<string>();
  state = beginThreadPageRequest(state, { requestId: 1, cursor: null, pageIndex: 0 });
  state = beginThreadPageRequest(state, { requestId: 2, cursor: null, pageIndex: 0 });

  state = completeThreadPageRequest(state, {
    requestId: 1,
    cursor: null,
    pageIndex: 0,
    items: ["stale"],
    nextCursor: null,
  });

  assert.deepEqual(state.items, []);
  assert.equal(state.isLoading, true);

  state = completeThreadPageRequest(state, {
    requestId: 2,
    cursor: null,
    pageIndex: 0,
    items: ["latest"],
    nextCursor: null,
  });

  assert.deepEqual(state.items, ["latest"]);
  assert.equal(state.isLoading, false);
});

test("page-size changes start page one without blanking visible items", () => {
  let state = createThreadPagingState<string>();
  state = completeThreadPageRequest(
    beginThreadPageRequest(state, { requestId: 1, cursor: "page-3", pageIndex: 2 }),
    {
      requestId: 1,
      cursor: "page-3",
      pageIndex: 2,
      items: ["visible-before-change"],
      nextCursor: "page-4",
    },
  );

  state = beginThreadPageRequest(state, {
    requestId: 2,
    cursor: null,
    pageIndex: 0,
    pageSize: 50,
  });

  assert.deepEqual(state.items, ["visible-before-change"]);
  assert.equal(state.pageSize, 50);
  assert.equal(state.currentPageIndex, 0);
  assert.deepEqual(state.pageCursors, [null]);
  assert.equal(state.nextCursor, null);
  assert.equal(state.isLoading, true);
});

test("thread paging records only the latest request failure", () => {
  let state = createThreadPagingState<string>();
  state = beginThreadPageRequest(state, { requestId: 1, cursor: null, pageIndex: 0 });
  state = beginThreadPageRequest(state, { requestId: 2, cursor: null, pageIndex: 0 });

  state = failThreadPageRequest(state, {
    requestId: 1,
    error: "stale failure",
  });

  assert.equal(state.error, null);
  assert.equal(state.isLoading, true);

  state = failThreadPageRequest(state, {
    requestId: 2,
    error: "latest failure",
  });

  assert.equal(state.error, "latest failure");
  assert.equal(state.isLoading, false);
});

test("previous and next page requests use stored cursors", () => {
  let state = createThreadPagingState<string>();
  state = completeThreadPageRequest(
    beginThreadPageRequest(state, { requestId: 1, cursor: null, pageIndex: 0 }),
    {
      requestId: 1,
      cursor: null,
      pageIndex: 0,
      items: ["page-1"],
      nextCursor: "cursor-2",
    },
  );

  assert.equal(getPreviousThreadPageRequest(state), null);
  assert.deepEqual(getNextThreadPageRequest(state), { cursor: "cursor-2", pageIndex: 1 });

  state = completeThreadPageRequest(
    beginThreadPageRequest(state, { requestId: 2, cursor: "cursor-2", pageIndex: 1 }),
    {
      requestId: 2,
      cursor: "cursor-2",
      pageIndex: 1,
      items: ["page-2"],
      nextCursor: "cursor-3",
    },
  );

  assert.deepEqual(getPreviousThreadPageRequest(state), { cursor: null, pageIndex: 0 });
  assert.deepEqual(getNextThreadPageRequest(state), { cursor: "cursor-3", pageIndex: 2 });
});
