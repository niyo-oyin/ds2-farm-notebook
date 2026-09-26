import { useEffect, useRef, useState } from 'react';
import { imageToBase64, imageUrl, type ScreenType } from '../api';
import { closeCapture, reviewJob, submitJob, useImportJobs } from '../store/jobs';
import { useApp } from './app-context';
import { runningAsApp } from './use-touch';
import './CameraCapture.css';

/**
 * アプリ内カメラ。カメラの映像を全画面に出し、シャッターを押すたびにその場で送信して、そのまま次を撮れる。
 * 横持ちの右手の親指で操作できるよう、シャッターと操作を右端に縦に並べる（縦持ちでは下端に横に並べる）。
 * 画面の回転をロックしたまま横に持って撮る場合は、設定「縦向きの写真の回転」に合わせて、枠・文字・操作の位置を持ち方の向きにそろえる。
 */
export function CameraCapture({ scope, targetId, onClose }: { scope: ScreenType[]; targetId?: string; onClose: () => void }) {
  const app = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(0);
  const [sent, setSent] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [guide, setGuide] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [portraitFrame, setPortraitFrame] = useState(false);
  // 縦長の映像を送る時に回す向き。回すなら、スマホは横に持たれている
  const turn = portraitFrame ? app.data.settings.importPortraitRotation : undefined;
  const { jobs } = useImportJobs();
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const done = jobs.filter((j) => j.status === 'done');
  const latest = jobs[jobs.length - 1];

  // テレビ画面を合わせる 16:9 の枠。映像が実際に映っている範囲（object-fit: contain）の中に、少し余白を残して置く。
  // 横に持って縦長の映像を撮る時（turn あり）は、持ち方から見て横長になるよう画面上は 9:16 にする
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const update = () => {
      if (!v.videoWidth) return;
      setPortraitFrame(v.videoHeight > v.videoWidth);
      const scale = Math.min(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
      const w = v.videoWidth * scale, h = v.videoHeight * scale;
      const long = turn ? Math.min(h, (w * 16) / 9) * 0.92 : Math.min(w, (h * 16) / 9) * 0.92, short = (long * 9) / 16;
      const [width, height] = turn ? [short, long] : [long, short];
      setGuide({ left: v.offsetLeft + (v.clientWidth - width) / 2, top: v.offsetTop + (v.clientHeight - height) / 2, width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(v);
    v.addEventListener('loadedmetadata', update);
    return () => { observer.disconnect(); v.removeEventListener('loadedmetadata', update); };
  }, [turn]);
  /** カメラを閉じて、読み取りの終わった最初の写真の確認を開く */
  const review = () => { onClose(); closeCapture(); reviewJob(done[0].id); };

  useEffect(() => {
    let stream: MediaStream | null = null, cancelled = false;
    const start = () => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream?.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        setError('');
      })
      .catch((e: Error) => setError(e.name === 'NotAllowedError' ? 'カメラの使用が許可されていません。ブラウザの設定で、このサイトにカメラを許可してください。' : `カメラを起動できませんでした（${e.message}）`));
    // ホームに戻ったり別のアプリに切り替えたりすると、iPhone はカメラを止める。前面に戻った時に映像が止まっていたらつなぎ直す
    const resume = () => {
      if (document.hidden) return;
      const track = stream?.getVideoTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted) { setReady(false); void start(); }
      else void video.current?.play().catch(() => undefined);
    };
    void start();
    document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', resume); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => {
    // 撮影ダイアログの上で開いた時も、Esc で閉じるのはカメラだけにする
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);

  const shoot = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // 映像のその瞬間を切り取ってから送信を始める（送信の間も次を撮れる）
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    setFlash((f) => f + 1);
    setSending((n) => n + 1);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/jpeg', 0.92));
      const image = await imageToBase64(blob, 1600, undefined, 0, false, { portraitRotation: app.data.settings.importPortraitRotation });
      setLast(`data:${image.mediaType};base64,${image.image}`);
      await submitJob(image, scope, targetId);
      setSent((n) => n + 1);
      setError('');
    } catch (e) { setError(`送信できませんでした: ${(e as Error).message}`); }
    finally { setSending((n) => n - 1); }
  };

  const thumb = last ?? (latest ? imageUrl(latest.imageId) : null);
  return <div className={'camera-capture' + (turn ? ` turn-${turn}` : '')} role="dialog" aria-label="カメラで撮影">
    <video ref={video} className="camera-video" autoPlay playsInline muted onLoadedMetadata={() => setReady(true)} />
    {guide && <div className="camera-guide" style={guide} aria-hidden="true"><i /><i /><i /><i /></div>}
    {flash > 0 && <div key={flash} className="camera-flash" aria-hidden="true" />}
    {error && <div className="camera-error" role="alert">{error}</div>}
    <div className="camera-controls">
      {/* ホーム画面のアプリはアプリ自身を閉じられないので、閉じる操作を出さない（抜ける時はスワイプ。サムネイルから確認へは進める） */}
      {runningAsApp() ? <span className="camera-close-space" aria-hidden="true" /> : <button type="button" className="camera-close" onClick={onClose}>閉じる</button>}
      <button type="button" className="camera-shutter" disabled={!ready} onClick={() => void shoot()} aria-label="撮影して送信"><span /></button>
      <div className="camera-status" role="status">
        {/* サムネイルを押すと、読み取りの終わった写真の確認に進む（右上の数が確認待ちの件数） */}
        <button type="button" className="camera-thumb" disabled={!done.length} onClick={review} aria-label={done.length ? `確認待ち${done.length}件を確認する` : '確認待ちの写真はありません'}>
          {thumb ? <img src={thumb} alt="" /> : <span className="camera-thumb-empty" />}
          {done.length > 0 && <b className="camera-thumb-badge">{done.length}</b>}
        </button>
        <span>{sending ? '送信中…' : active ? `解析中 ${active}` : sent ? `${sent}枚送信` : '撮ると送信'}</span>
      </div>
    </div>
  </div>;
}
