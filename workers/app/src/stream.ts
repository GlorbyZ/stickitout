export type StreamVideo = {
  id?: string;
  uid?: string;
  preview?: string;
  thumbnail?: string;
  readyToStream?: boolean;
  requireSignedURLs?: boolean | null;
  hlsPlaybackUrl?: string;
  dashPlaybackUrl?: string;
  duration?: number;
  status?: { state?: string };
  meta?: Record<string, string>;
  allowedOrigins?: string[];
};

export type StreamBinding = {
  upload: (url: string, params?: Record<string, unknown>) => Promise<StreamVideo>;
  createDirectUpload: (params: {
    maxDurationSeconds: number;
    expiry?: string;
    requireSignedURLs?: boolean;
    allowedOrigins?: string[];
    meta?: Record<string, string>;
  }) => Promise<{ id: string; uploadURL: string }>;
  videos: { list: (params?: { limit?: number }) => Promise<StreamVideo[]> };
  video: (id: string) => {
    details: () => Promise<StreamVideo>;
    update: (params: Record<string, unknown>) => Promise<StreamVideo>;
    generateToken: () => Promise<string | { token?: string }>;
    delete: () => Promise<void>;
  };
};

export function streamOf(env: { STREAM?: StreamBinding }): StreamBinding | null {
  return env.STREAM || null;
}

export function videoId(v: StreamVideo | string): string {
  if (typeof v === 'string') return v;
  return v.uid || v.id || '';
}

export function customerFromPreview(preview = ''): string {
  const m = preview.match(/customer-([a-z0-9]+)\.cloudflarestream\.com/i);
  return m?.[1] || '';
}

export async function signedIframeSrc(
  env: { STREAM?: StreamBinding },
  uid: string,
): Promise<{ src: string; ready: boolean; error?: string }> {
  const stream = streamOf(env);
  if (!stream) return { src: '', ready: false, error: 'Stream is not bound on this Worker.' };
  if (!uid) return { src: '', ready: false, error: 'No Stream video on this lesson.' };
  try {
    const details = await stream.video(uid).details();
    const ready = Boolean(details.readyToStream);
    const locked = details.allowedOrigins && details.allowedOrigins.length > 0;
    if (locked) {
      try {
        await stream.video(uid).update({ allowedOrigins: [] });
      } catch {
        await stream.video(uid).update({
          allowedOrigins: [
            'admin.stickitoutdrums.com',
            'member.stickitoutdrums.com',
            '*.stickitoutdrums.com',
            '*.cloudflarestream.com',
            '*.videodelivery.net',
          ],
        });
      }
    }
    const tokenRaw = await stream.video(uid).generateToken();
    const token = (typeof tokenRaw === 'string' ? tokenRaw : tokenRaw.token || '').trim();
    const customer = customerFromPreview(
      details.preview || details.thumbnail || details.hlsPlaybackUrl || details.dashPlaybackUrl || '',
    );
    if (!token) return { src: '', ready, error: 'Could not sign playback.' };
    const src = customer
      ? `https://customer-${customer}.cloudflarestream.com/${token}/iframe`
      : `https://iframe.videodelivery.net/${token}`;
    return { src, ready };
  } catch (err) {
    return { src: '', ready: false, error: friendlyStreamError(err instanceof Error ? err.message : 'stream_error') };
  }
}

export async function startDirectUpload(
  env: { STREAM?: StreamBinding },
  meta: Record<string, string>,
): Promise<{ id: string; uploadURL: string } | { error: string }> {
  const stream = streamOf(env);
  if (!stream) return { error: 'Stream is not bound. Add the STREAM binding in wrangler and enable Stream on this account.' };
  try {
    const expiry = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    return await stream.createDirectUpload({
      maxDurationSeconds: 3600,
      expiry,
      requireSignedURLs: true,
      meta,
    });
  } catch (err) {
    return { error: friendlyStreamError(err instanceof Error ? err.message : 'upload_create_failed') };
  }
}

export async function ingestFromUrl(
  env: { STREAM?: StreamBinding },
  url: string,
  meta: Record<string, string>,
): Promise<{ id: string } | { error: string }> {
  const stream = streamOf(env);
  if (!stream) return { error: 'Stream is not bound.' };
  try {
    const video = await stream.upload(url, {
      requireSignedURLs: true,
      meta,
    });
    const id = videoId(video);
    if (!id) return { error: 'Upload returned no id.' };
    return { id };
  } catch (err) {
    return { error: friendlyStreamError(err instanceof Error ? err.message : 'url_ingest_failed') };
  }
}

export function canWatch(status: string): boolean {
  return status === 'founding' || status === 'active';
}

export function friendlyStreamError(msg: string): string {
  if (/does not implement/i.test(msg)) {
    return 'Stream is bound on this Worker. Uploads need Stream enabled on the Cloudflare account.';
  }
  if (/not enabled/i.test(msg) || /ForbiddenError/i.test(msg)) {
    return 'Cloudflare Stream is not enabled on this account yet. Open Stream in the dashboard, subscribe, then drop a file here.';
  }
  return msg.replace(/^ForbiddenError:\s*/i, '').replace(/^Error:\s*/i, '');
}

export const STREAM_DASH = 'https://dash.cloudflare.com/ca920695eda5d6f43cef8a5e7068b867/stream';

export async function probeStream(env: { STREAM?: StreamBinding }): Promise<{ ok: boolean; error?: string }> {
  const stream = streamOf(env);
  if (!stream) return { ok: false, error: 'Stream is not bound on this Worker.' };
  try {
    await stream.videos.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyStreamError(err instanceof Error ? err.message : 'stream_error') };
  }
}

export async function videoDetails(
  env: { STREAM?: StreamBinding },
  uid: string,
): Promise<{ ready: boolean; thumbnail: string; duration: number } | null> {
  const stream = streamOf(env);
  if (!stream || !uid) return null;
  try {
    const details = await stream.video(uid).details();
    return {
      ready: Boolean(details.readyToStream),
      thumbnail: details.thumbnail || '',
      duration: typeof details.duration === 'number' && details.duration > 0 ? details.duration : 0,
    };
  } catch {
    return null;
  }
}

export async function signedThumbnail(env: { STREAM?: StreamBinding }, uid: string): Promise<string> {
  const stream = streamOf(env);
  if (!stream || !uid) return '';
  try {
    const details = await stream.video(uid).details();
    const tokenRaw = await stream.video(uid).generateToken();
    const token = (typeof tokenRaw === 'string' ? tokenRaw : tokenRaw.token || '').trim();
    const customer = customerFromPreview(
      details.preview || details.thumbnail || details.hlsPlaybackUrl || details.dashPlaybackUrl || '',
    );
    if (token && customer) {
      return `https://customer-${customer}.cloudflarestream.com/${token}/thumbnails/thumbnail.jpg?time=0s&height=720`;
    }
    return details.thumbnail || '';
  } catch {
    return '';
  }
}

export type PosterLesson = { id: string; poster_key?: string | null; stream_uid?: string | null };

export async function lessonPoster(
  env: { STREAM?: StreamBinding },
  lesson: PosterLesson,
  base: string,
): Promise<string> {
  if (lesson.poster_key) return `${base}/media/lessons/${lesson.id}`;
  if (lesson.stream_uid) return signedThumbnail(env, lesson.stream_uid);
  return '';
}

const POSTER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function putLessonPoster(
  env: { MEDIA?: R2Bucket },
  lessonId: string,
  file: File,
): Promise<{ key: string } | { error: string }> {
  if (!env.MEDIA) return { error: 'Media bucket is not bound.' };
  if (file.size > 5 * 1024 * 1024) return { error: 'Keep posters under 5MB.' };
  const ext = POSTER_TYPES[file.type];
  if (!ext) return { error: 'Use a JPG, PNG, or WebP still.' };
  const key = `lessons/${lessonId}/poster.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return { key };
}

export async function putAvatar(
  env: { MEDIA?: R2Bucket },
  personId: string,
  file: File,
): Promise<{ key: string } | { error: string }> {
  if (!env.MEDIA) return { error: 'Media bucket is not bound.' };
  if (file.size > 4 * 1024 * 1024) return { error: 'Keep the photo under 4MB.' };
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : '';
  if (!ext) return { error: 'Use a JPG, PNG, or WebP photo.' };
  const key = `avatars/${personId}.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { key };
}

export async function readLessonPoster(
  env: { MEDIA?: R2Bucket },
  key: string,
): Promise<R2ObjectBody | null> {
  if (!env.MEDIA || !key) return null;
  return env.MEDIA.get(key);
}
