import * as React from 'react';
import * as runtime from 'react/jsx-runtime';
import * as development from 'react/jsx-dev-runtime';
// Windows의 로컬 Vite SSR 검증용. 서비스 번들에는 포함되지 않는다.
globalThis.__nativeReviewReact = React;
globalThis.__nativeReviewJsx = { ...runtime, ...development };
export default {
  name: 'native-react-review',
  enforce: 'pre',
  resolveId(id) {
    if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].includes(id))
      return `\0native-review:${id}`;
  },
  load(id) {
    if (id === '\0native-review:react')
      return 'export const {useId,useRef,useState,useEffect,useCallback,useMemo,useLayoutEffect,forwardRef,createElement} = globalThis.__nativeReviewReact;';
    if (id === '\0native-review:react/jsx-runtime')
      return 'export const {jsx,jsxs,Fragment} = globalThis.__nativeReviewJsx;';
    if (id === '\0native-review:react/jsx-dev-runtime')
      return 'export const {jsxDEV,Fragment} = globalThis.__nativeReviewJsx;';
  },
};
