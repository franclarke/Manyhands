import * as ReactNamespace from 'react-original';

const ReactOriginal = ReactNamespace.default || ReactNamespace;

export const version = ReactOriginal.version;
export const Children = ReactOriginal.Children;
export const createRef = ReactOriginal.createRef;
export const Component = ReactOriginal.Component;
export const PureComponent = ReactOriginal.PureComponent;
export const createContext = ReactOriginal.createContext;
export const forwardRef = ReactOriginal.forwardRef;
export const lazy = ReactOriginal.lazy;
export const memo = ReactOriginal.memo;
export const cache = ReactOriginal.cache;
export const error = ReactOriginal.error;

export const createElement = ReactOriginal.createElement;
export const cloneElement = ReactOriginal.cloneElement;
export const isValidElement = ReactOriginal.isValidElement;

export const Fragment = ReactOriginal.Fragment;
export const StrictMode = ReactOriginal.StrictMode;
export const Suspense = ReactOriginal.Suspense;
export const Activity = ReactOriginal.Activity;
export const Profiler = ReactOriginal.Profiler;

export const useState = ReactOriginal.useState;
export const useEffect = ReactOriginal.useEffect;
export const useContext = ReactOriginal.useContext;
export const useReducer = ReactOriginal.useReducer;
export const useCallback = ReactOriginal.useCallback;
export const useMemo = ReactOriginal.useMemo;
export const useRef = ReactOriginal.useRef;
export const useImperativeHandle = ReactOriginal.useImperativeHandle;
export const useLayoutEffect = ReactOriginal.useLayoutEffect;
export const useDebugValue = ReactOriginal.useDebugValue;
export const useDeferredValue = ReactOriginal.useDeferredValue;
export const useTransition = ReactOriginal.useTransition;
export const useId = ReactOriginal.useId;
export const useSyncExternalStore = ReactOriginal.useSyncExternalStore;
export const useInsertionEffect = ReactOriginal.useInsertionEffect;
export const use = ReactOriginal.use;

export const startTransition = ReactOriginal.startTransition;

// Shims using local variable ReactOriginal (so Webpack doesn't statically check namespace exports)
export const useEffectEvent =
  ReactOriginal.experimental_useEffectEvent ||
  ReactOriginal.useEffectEvent ||
  ((fn) => fn);

export const __CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  ReactOriginal.__CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ||
  ReactOriginal.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ||
  {};

export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  ReactOriginal.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ||
  ReactOriginal.__CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ||
  {};

const ReactShim = {
  ...ReactOriginal,
  useEffectEvent,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
};

export default ReactShim;
