
declare module 'react' {
  export type Key = string | number | symbol;
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactNodeArray;
  export interface ReactNodeArray extends Array<ReactNode> {}
  export interface ReactElement {
    type: any;
    props: any;
    key: any;
  }
  export interface RefObject<T> {
    readonly current: T | null;
  }
  export interface MutableRefObject<T> {
    current: T;
  }
  export function useRef<T>(initialValue: T): MutableRefObject<T>;
  export function useRef<T>(initialValue: T | null): RefObject<T>;
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
  export function useState<T = undefined>(): [T | undefined, Dispatch<SetStateAction<T | undefined>>];
  export function useCallback<F extends (...args: any[]) => any>(callback: F, deps: any[]): F;
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useMemo<T>(factory: () => T, deps: any[]): T;
  export function useTransition(): [boolean, (callback: () => void) => void];
  export function useContext<T>(context: any): T;
  export function createContext<T>(defaultValue: T): any;
  export function forwardRef<T, P = {}>(render: (props: P, ref: any) => ReactElement | null): any;

  // Common React top-level APIs
  export const memo: any;
  export const createRef: any;
  export const Children: any;
  export const Fragment: any;
  export const Component: any;
  export const PureComponent: any;
  export const isValidElement: any;
  export const cloneElement: any;
  export const StrictMode: any;
  export const Suspense: any;
  export const lazy: any;
  export const startTransition: any;
  export function useId(): string;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useImperativeHandle<T, R extends T>(ref: any, init: () => R, deps?: any[]): void;
  export function useDeferredValue<T>(value: T): T;
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T
  ): T;

  // Standard synthetic event typings for form and input event handlers
  export type FormEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type MouseEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type FocusEvent<T = any> = any;
  export type TouchEvent<T = any> = any;
  export type PointerEvent<T = any> = any;
  export type UIEvent<T = any> = any;
  export type SyntheticEvent<T = any> = any;

  // Component and styling utility typings
  export type FC<P = {}> = (props: P) => ReactElement | null;
  export type FunctionComponent<P = {}> = FC<P>;
  export type ComponentType<P = {}> = any;
  export type ComponentProps<T> = any;
  export type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  export type CSSProperties = { [key: string]: any };

  // Runtime value catch-all for React.* calls (e.g. React.memo, React.createRef)
  interface ReactCatchAll {
    [key: string]: any;
  }
  const _default: ReactCatchAll;
  export default _default;
}

// Global ambient namespace for qualified type annotations (e.g. React.FormEvent, JSX.Element)
declare global {
  namespace JSX {
    interface Element extends import('react').ReactElement {}
  }
  namespace React {
    type FormEvent<T = any> = any;
    type ChangeEvent<T = any> = any;
    type MouseEvent<T = any> = any;
    type KeyboardEvent<T = any> = any;
    type FocusEvent<T = any> = any;
    type TouchEvent<T = any> = any;
    type PointerEvent<T = any> = any;
    type UIEvent<T = any> = any;
    type SyntheticEvent<T = any> = any;
    type ReactNode = import('react').ReactNode;
    type ReactElement = import('react').ReactElement;
    type RefObject<T> = import('react').RefObject<T>;
    type MutableRefObject<T> = import('react').MutableRefObject<T>;
    type FC<P = {}> = import('react').FC<P>;
    type CSSProperties = import('react').CSSProperties;
    type PropsWithChildren<P = {}> = import('react').PropsWithChildren<P>;
    type Key = import('react').Key;
  }
}
declare module 'react-dom/client';
declare module 'framer-motion';
declare module 'lucide-react';
declare module 'three' {
  interface ThreeCatchAll {
    [key: string]: any;
  }
  const THREE: ThreeCatchAll;
  namespace THREE {
    export type Vector3 = any;
    export type Object3D = any;
    export type Mesh = any;
    export type Group = any;
    export type Color = any;
    export type Euler = any;
    export type Quaternion = any;
    export type Material = any;
    export type Texture = any;
    export type PointLight = any;
    export type Sprite = any;
    export type CanvasTexture = any;
    export type DirectionalLight = any;
    export type AmbientLight = any;
    export type SpotLight = any;
    export type Scene = any;
    export type Camera = any;
    export type PerspectiveCamera = any;
    export type InstancedMesh = any;
    export type MeshStandardMaterial = any;
    export type MeshBasicMaterial = any;
    export type MeshPhongMaterial = any;
    export type BoxGeometry = any;
    export type SphereGeometry = any;
    export type PlaneGeometry = any;
    export type CylinderGeometry = any;
    export type IcosahedronGeometry = any;
  }
  export = THREE;
}

declare module 'react/jsx-runtime' {
  import { ReactNode } from 'react';
  export namespace JSX {
    interface IntrinsicAttributes {
      key?: string | number | symbol;
      [propName: string]: any;
    }
    interface IntrinsicElements {
      [elemName: string]: {
        children?: ReactNode;
        [propName: string]: any;
      };
    }
  }
}
