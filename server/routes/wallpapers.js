import express from '../compat/express.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
  MAX_WALLPAPER_BYTES,
  deleteWallpaper,
  getBingSyncStatus,
  listWallpapers,
  replaceWallpaperContent,
  saveWallpaper,
  syncLatestBingWallpaper
} from '../services/wallpaperService.js';

const router = express.Router();
const MAX_UPLOAD_REQUEST_BYTES = 13 * 1024 * 1024;

// 与 worker 入口的 Content-Length 预检不同，这里对分块（chunked）请求
// 也强制在读取过程中限制总字节数，避免整包进入内存后才被拒绝。
async function readUploadForm(request) {
    const body = request.body;
    if (!body) return request.formData();
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_UPLOAD_REQUEST_BYTES) {
                await reader.cancel();
                throw Object.assign(new Error('上传内容不能超过 12MB'), { status: 413 });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const cappedRequest = new Request(request, {
        body: new Blob(chunks),
        method: request.method,
        headers: request.headers
    });
    return cappedRequest.formData();
}

router.use(authMiddleware);
router.use(adminOnly);

router.get('/', async (req, res) => {
  try {
    const wallpapers = await listWallpapers(req.query.limit);
    res.json({ wallpapers });
  } catch (error) {
    console.error('List wallpapers error:', error);
    res.status(500).json({ error: error.message || '加载壁纸失败' });
  }
});

router.post('/bing/sync', async (req, res) => {
  try {
    const result = await syncLatestBingWallpaper({ selectWhenEnabled: false });
    res.json({
      message: 'Bing 最新壁纸已保存到图库',
      ...result
    });
  } catch (error) {
    console.error('Sync Bing wallpaper error:', error);
    res.status(502).json({ error: error.message || '同步 Bing 壁纸失败' });
  }
});

router.get('/bing/status', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: await getBingSyncStatus() });
  } catch (error) {
    console.error('Read Bing wallpaper sync status error:', error);
    res.status(500).json({ error: '读取 Bing 同步状态失败' });
  }
});

router.post('/upload', async (req, res) => {
  try {
    const form = await readUploadForm(req.raw);
    const image = form.get('image');
    if (!image || typeof image.arrayBuffer !== 'function') {
      return res.status(400).json({ error: '请选择要上传的背景图片' });
    }
    if (!image.size || image.size > MAX_WALLPAPER_BYTES) {
      return res.status(413).json({ error: '图片大小必须在 12MB 以内' });
    }

    // 客户端上传时计算主题色 accent（与登录页同一算法，随表单提交，
    // 服务端落库存储——上传图可能是 WebP/PNG，服务端纯 JS 无法解码）。
    let accent = null;
    const accentRaw = form.get('accent');
    if (accentRaw) {
      try { accent = JSON.parse(accentRaw); } catch { accent = null; }
    }

    const wallpaper = await saveWallpaper({
      bytes: await image.arrayBuffer(),
      contentType: image.type,
      sourceType: 'upload',
      title: form.get('title') || image.name,
      createdBy: req.user.id,
      accent
    });
    res.status(201).json({ message: '背景图片已保存到图库', wallpaper });
  } catch (error) {
    console.error('Upload wallpaper error:', error);
    const status = Number(error.status) || 400;
    res.status(status >= 400 && status < 600 ? status : 400).json({ error: error.message || '上传背景图片失败' });
  }
});

router.post('/:id/replace', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: '壁纸编号无效' });
    }
    const form = await readUploadForm(req.raw);
    const image = form.get('image');
    if (!image || typeof image.arrayBuffer !== 'function') {
      return res.status(400).json({ error: '请选择要替换的图片' });
    }
    if (!image.size || image.size > MAX_WALLPAPER_BYTES) {
      return res.status(413).json({ error: '图片大小必须在 12MB 以内' });
    }
    const origin = new URL(req.raw.url).origin;
    const wallpaper = await replaceWallpaperContent(
      id,
      { bytes: await image.arrayBuffer(), contentType: image.type },
      { origin }
    );
    if (!wallpaper) return res.status(404).json({ error: '壁纸不存在' });
    res.json({ message: '壁纸内容已替换（新版本已生成）', wallpaper });
  } catch (error) {
    console.error('Replace wallpaper error:', error);
    const status = Number(error.status) || 400;
    res.status(status >= 400 && status < 600 ? status : 400).json({ error: error.message || '替换壁纸失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: '壁纸编号无效' });
    }
    const origin = new URL(req.raw.url).origin;
    const deleted = await deleteWallpaper(id, { origin });
    if (!deleted) return res.status(404).json({ error: '壁纸不存在' });
    res.json({ message: '壁纸已删除' });
  } catch (error) {
    console.error('Delete wallpaper error:', error);
    res.status(500).json({ error: error.message || '删除壁纸失败' });
  }
});

export default router;
