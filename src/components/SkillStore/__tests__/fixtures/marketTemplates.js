// 技能广场测试用的固定响应，不参与运行时逻辑
const item = (id, name, type, width, height, likes) => ({
  id,
  folder_name: id,
  name,
  version: 1,
  likes_count: likes,
  web_share: `https://example.com/share/${id}`,
  preview: {
    type,
    url: `https://example.com/preview/${id}.${type === 'video' ? 'mp4' : 'jpg'}`,
    cover_url: `https://example.com/cover/${id}.jpg`,
    width,
    height,
  },
  package: { download_url: `https://example.com/package/${id}.zip` },
});

export const templates = [
  item('tuangou-one-image-draft', '一张图生成餐厅引流团购视频', 'video', 1080, 1920, 1000),
  item('micro-world-product-draft', '微缩世界化妆品带货', 'image', 1080, 1920, 10000),
  item('maternal-science-koubo-draft', '母婴知识带货奶粉', 'image', 1080, 1920, 6000),
  item('tiny-world-rescue-30s', '30秒拯救小人国', 'video', 1080, 1920, 207000),
  item('one-photo-fashion-supermarket-video', '一张服装图生成超市偶遇视频', 'video', 2048, 2048, 4000),
  item('native-dialogue-rush-product-draft', 'AI围抢原生对白带货复刻', 'video', 1080, 1920, 36000),
];

export const templatePage = (offset = 0, limit = 20) => ({
  code: 0,
  message: 'success',
  total: templates.length,
  data: templates.slice(offset, offset + limit),
  offset,
  limit,
});
