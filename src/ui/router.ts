import { useEffect, useState } from 'react';

export interface Route { path: string; params: URLSearchParams; }
function parse(): Route {
  const h = location.hash.replace(/^#/, '') || '/mating';
  const [path, q = ''] = h.split('?');
  return { path, params: new URLSearchParams(q) };
}
export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => { setR(parse()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export function navigate(path: string, params?: Record<string, string>) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = path + q;
}
