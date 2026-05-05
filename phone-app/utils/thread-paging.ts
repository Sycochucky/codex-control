export const THREAD_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export type ThreadPageSize = (typeof THREAD_PAGE_SIZE_OPTIONS)[number];

export type ThreadPageRequest = {
  cursor: string | null;
  pageIndex: number;
};

export type ThreadPagingState<T> = {
  items: T[];
  pageSize: ThreadPageSize;
  pageCursors: Array<string | null>;
  currentPageIndex: number;
  nextCursor: string | null;
  isLoading: boolean;
  hasLoadedPage: boolean;
  error: string | null;
  activeRequestId: number;
};

type BeginThreadPageRequest = ThreadPageRequest & {
  requestId: number;
  pageSize?: ThreadPageSize;
};

type CompleteThreadPageRequest<T> = ThreadPageRequest & {
  requestId: number;
  items: T[];
  nextCursor: string | null | undefined;
};

type FailThreadPageRequest = {
  requestId: number;
  error: string;
};

export function createThreadPagingState<T>(
  initial?: Partial<Pick<ThreadPagingState<T>, "items" | "pageSize">>,
): ThreadPagingState<T> {
  return {
    items: initial?.items ?? [],
    pageSize: initial?.pageSize ?? 25,
    pageCursors: [null],
    currentPageIndex: 0,
    nextCursor: null,
    isLoading: true,
    hasLoadedPage: false,
    error: null,
    activeRequestId: 0,
  };
}

export function beginThreadPageRequest<T>(
  state: ThreadPagingState<T>,
  request: BeginThreadPageRequest,
): ThreadPagingState<T> {
  const pageSize = request.pageSize ?? state.pageSize;
  const startsAtFirstPage = request.pageIndex === 0;

  return {
    ...state,
    pageSize,
    pageCursors: startsAtFirstPage ? [null] : state.pageCursors,
    currentPageIndex: startsAtFirstPage ? 0 : state.currentPageIndex,
    nextCursor: startsAtFirstPage ? null : state.nextCursor,
    isLoading: true,
    activeRequestId: request.requestId,
  };
}

export function completeThreadPageRequest<T>(
  state: ThreadPagingState<T>,
  request: CompleteThreadPageRequest<T>,
): ThreadPagingState<T> {
  if (request.requestId !== state.activeRequestId) {
    return state;
  }

  return {
    ...state,
    items: request.items,
    pageCursors: rememberPageCursor(state.pageCursors, request.pageIndex, request.cursor),
    currentPageIndex: request.pageIndex,
    nextCursor: normalizeCursor(request.nextCursor),
    isLoading: false,
    hasLoadedPage: true,
    error: null,
  };
}

export function failThreadPageRequest<T>(
  state: ThreadPagingState<T>,
  request: FailThreadPageRequest,
): ThreadPagingState<T> {
  if (request.requestId !== state.activeRequestId) {
    return state;
  }

  return {
    ...state,
    isLoading: false,
    error: request.error,
  };
}

export function getPreviousThreadPageRequest<T>(
  state: Pick<ThreadPagingState<T>, "currentPageIndex" | "pageCursors">,
): ThreadPageRequest | null {
  if (state.currentPageIndex <= 0) {
    return null;
  }

  const pageIndex = state.currentPageIndex - 1;
  return {
    cursor: state.pageCursors[pageIndex] ?? null,
    pageIndex,
  };
}

export function getNextThreadPageRequest<T>(
  state: Pick<ThreadPagingState<T>, "currentPageIndex" | "nextCursor">,
): ThreadPageRequest | null {
  const cursor = normalizeCursor(state.nextCursor);
  if (!cursor) {
    return null;
  }

  return {
    cursor,
    pageIndex: state.currentPageIndex + 1,
  };
}

export function getRefreshThreadPageRequest<T>(
  state: Pick<ThreadPagingState<T>, "currentPageIndex" | "pageCursors">,
): ThreadPageRequest {
  return {
    cursor: state.pageCursors[state.currentPageIndex] ?? null,
    pageIndex: state.currentPageIndex,
  };
}

function rememberPageCursor(
  current: Array<string | null>,
  pageIndex: number,
  cursor: string | null,
) {
  const updated = current.slice(0, pageIndex + 1);
  updated[pageIndex] = normalizeCursor(cursor);
  return updated.length ? updated : [null];
}

function normalizeCursor(cursor: string | null | undefined) {
  return cursor?.trim() || null;
}
