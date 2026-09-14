import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  assertAllowedWallpaperType,
  assertWallpaperBytesMatchType,
  parseLatestBingWallpaper,
  validateBingImageUrl,
  withLoginSize
} from '../server/services/wallpaperService.js';
import {
  computeWallpaperAccentFromJpeg,
  normalizeThemeAccent
} from '../server/utils/wallpaperAccent.js';

// 官方 Bing 归档接口（HPImageArchive.aspx）的真实返回结构。
const payload = {
  images: [{
    startdate: '20260729',
    fullstartdate: '202607291600',
    enddate: '20260730',
    url: '/th?id=OHR.Sample_UHD_ZH-CN123_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
    urlbase: '/th?id=OHR.Sample_UHD_ZH-CN123',
    copyright: '示例壁纸，安全使用 (© Sample/Unsplash)',
    title: '示例'
  }]
};

assert.deepEqual(parseLatestBingWallpaper(payload), {
  imageUrl: 'https://cn.bing.com/th?id=OHR.Sample_UHD_ZH-CN123_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  sourceDate: '2026-07-29',
  title: '示例壁纸，安全使用 (© Sample/Unsplash)'
});

assert.equal(assertAllowedWallpaperType('image/webp; charset=binary'), 'image/webp');
assert.throws(() => assertAllowedWallpaperType('image/svg+xml'), /仅支持/);
assert.equal(assertWallpaperBytesMatchType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), 'image/jpeg');
assert.equal(assertWallpaperBytesMatchType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), 'image/png');
assert.throws(
  () => assertWallpaperBytesMatchType(new TextEncoder().encode('<svg></svg>'), 'image/png'),
  /内容与声明格式不一致/
);
assert.throws(() => validateBingImageUrl('https://example.com/image.jpg'), /不可信/);
assert.throws(() => validateBingImageUrl('https://cn.bing.com:8080/th?id=x'), /不可信/, '非 443 端口必须拒绝');
assert.throws(
  () => parseLatestBingWallpaper({ images: [{ startdate: 'today', url: '/th?id=x' }] }),
  /日期格式无效/
);
assert.throws(() => parseLatestBingWallpaper({}), /未能从 Bing 官方接口解析最新壁纸/);
assert.throws(() => parseLatestBingWallpaper({ images: [] }), /未能从 Bing 官方接口解析最新壁纸/);

// Bing URL 中已有尺寸参数时必须被覆盖而非重复追加。
assert.equal(
  withLoginSize('https://cn.bing.com/th?id=OHR.Sample_UHD.jpg&pid=hp&w=3840&h=2160'),
  'https://cn.bing.com/th?id=OHR.Sample_UHD.jpg&pid=hp&w=1920&h=1080'
);
assert.equal(
  withLoginSize('https://cn.bing.com/th?id=OHR.Sample_UHD.jpg&pid=hp'),
  'https://cn.bing.com/th?id=OHR.Sample_UHD.jpg&pid=hp&w=1920&h=1080'
);
const sized = new URL(withLoginSize('https://cn.bing.com/th?id=OHR.Sample_UHD.jpg&pid=hp&w=3840&h=2160'));
assert.equal(sized.searchParams.get('w'), '1920');
assert.equal(sized.searchParams.get('h'), '1080');
assert.equal([...sized.searchParams.keys()].filter(key => key === 'w').length, 1);

// ============ 主题色落库计算（服务端 JPEG 解码 + 同一算法） ============

// 服务端必须能从 JPEG 字节解码计算主题色（Bing 路径，无需浏览器）。
for (const [name, rgb, allowedKeys] of [
  ['纯红', [255, 0, 0], ['red', 'rose']],
  ['纯绿', [0, 200, 0], ['green']],
  ['纯蓝', [0, 0, 255], ['blue', 'indigo', 'cyan']]
]) {
  const jpeg = await sharp({
    create: { width: 240, height: 135, channels: 3, background: rgb }
  }).jpeg({ quality: 90 }).toBuffer();
  const accent = computeWallpaperAccentFromJpeg(new Uint8Array(jpeg));
  assert.ok(
    allowedKeys.includes(accent.themeKey),
    `${name} 必须归入 ${allowedKeys.join('/')} 主题族，实际为 ${accent.themeKey} (${accent.rgb})`
  );
  assert.match(accent.rgb, /^\d{1,3}( \d{1,3}){2}$/, '主题色 RGB 必须是空格分隔的三通道');
}

// 客户端上传提交的 accent 形状校验：合法通过，非法拒绝。
assert.deepEqual(normalizeThemeAccent({ rgb: '59 130 246', themeKey: 'blue' }), { rgb: '59 130 246', themeKey: 'blue' });
assert.equal(normalizeThemeAccent({ rgb: '999 0 0', themeKey: 'red' }), null, '通道越界必须拒绝');
assert.equal(normalizeThemeAccent({ rgb: '59 130', themeKey: 'blue' }), null, '通道数不对必须拒绝');
assert.equal(normalizeThemeAccent({ rgb: '59 130 246', themeKey: 'not-a-theme' }), null, '未知主题键必须拒绝');
assert.equal(normalizeThemeAccent(null), null);
assert.equal(normalizeThemeAccent('blue'), null);
assert.equal(normalizeThemeAccent({ rgb: 123, themeKey: 'blue' }), null);

console.log('Wallpaper engine tests passed');
