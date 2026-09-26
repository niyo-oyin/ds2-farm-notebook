// タッチ操作の端末かどうかと、アプリ内カメラが使えるかどうか。
import { useSyncExternalStore } from 'react';

const coarse = typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)') : null;
/** 指で操作する端末（スマホ・タブレット）。横持ちで画面幅が広くても判定できるよう、幅ではなくポインターで見る */
export const useTouch = () => useSyncExternalStore((cb) => { coarse?.addEventListener('change', cb); return () => coarse?.removeEventListener('change', cb); }, () => !!coarse?.matches);
/** ブラウザでカメラの映像を扱えるか。HTTPS（安全な接続）でだけ使える */
export const inAppCameraAvailable = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/**
 * ホーム画面のアイコン（manifest の start_url に ?camera=1）から開いた印。読み込み時に1回だけ読み、アドレスからは外す（再読み込みでまた開かないように）。
 * 最初の同期で画面が作り直されてもカメラを開いたままにするため、カメラを閉じるまで残す。
 */
let cameraLaunch = typeof location !== 'undefined' && new URLSearchParams(location.search).has('camera');
if (cameraLaunch) history.replaceState(history.state, '', location.pathname + location.hash);
/** ホーム画面から開いて、まだカメラを閉じていない（スマホでカメラが使える時だけ） */
export const cameraLaunchPending = () => cameraLaunch && !!coarse?.matches && inAppCameraAvailable();
export const endCameraLaunch = () => { cameraLaunch = false; };

/** ホーム画面に追加したアプリとして全画面で動いている（Safari の standalone 表示）。自分自身を閉じる手段がないので、閉じる操作を出さない判断に使う */
export const runningAsApp = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
