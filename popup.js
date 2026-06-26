document.addEventListener('DOMContentLoaded', () => {
  const scopeRadios = document.querySelectorAll('input[name="scope"]');
  const countInput = document.getElementById('count');
  const downloadBtn = document.getElementById('download');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');

  // 切换数量输入框状态
  scopeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      countInput.disabled = radio.value === 'all';
    });
  });

  // 下载按钮点击
  downloadBtn.addEventListener('click', async () => {
    const scope = document.querySelector('input[name="scope"]:checked').value;
    const format = document.querySelector('input[name="format"]:checked').value;
    const count = scope === 'recent' ? parseInt(countInput.value) : null;

    if (scope === 'recent' && (!count || count < 1)) {
      showError('请输入有效的推文数量');
      return;
    }

    try {
      hideError();
      showStatus('正在获取推文...');
      downloadBtn.disabled = true;

      // 获取当前活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // 检查是否在微博页面
      if (!tab.url || !tab.url.includes('weibo.com')) {
        throw new Error('请先打开微博网站 (weibo.com)');
      }

      // 获取用户 ID
      const userId = getUserIdFromUrl(tab.url);
      if (!userId) {
        throw new Error('无法获取用户 ID，请确保在用户主页上（如 weibo.com/u/2028563263），自己主页，或者某个人的主页。');
      }

      // 逐页获取推文
      const tweets = await fetchAllTweets(userId, scope, count);

      if (!tweets || tweets.length === 0) {
        throw new Error('未找到推文，请确保已登录微博');
      }

      showStatus(`已获取 ${tweets.length} 条推文，正在生成文件...`);

      // 生成文件内容
      let content, filename, mimeType;
      if (format === 'markdown') {
        content = generateMarkdown(tweets);
        filename = `weibo_tweets_${getDateStr()}.md`;
        mimeType = 'text/markdown';
      } else {
        content = generateHTML(tweets);
        filename = `weibo_tweets_${getDateStr()}.html`;
        mimeType = 'text/html';
      }

      // 下载文件
      const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

      await chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      });

      showStatus('下载完成！');
      setTimeout(() => hideStatus(), 2000);

    } catch (error) {
      showError(error.message);
    } finally {
      downloadBtn.disabled = false;
    }
  });

  // 从 URL 获取用户 ID（微博格式：weibo.com/u/数字ID）
  function getUserIdFromUrl(url) {
    const match = url.match(/weibo\.com\/u\/(\d+)/);
    return match ? match[1] : null;
  }

  // 逐页获取所有推文
  async function fetchAllTweets(userId, scope, count) {
    const allTweets = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      showStatus(`正在获取第 ${page} 页...（已获取 ${allTweets.length} 条）`);

      try {
        const result = await fetchTweetsFromApi(userId, page);

        if (!result.tweets || result.tweets.length === 0) {
          hasNext = false;
          break;
        }

        // 如果指定了数量，截取到目标数量
        if (scope === 'recent' && count) {
          const remaining = count - allTweets.length;
          if (remaining <= 0) {
            hasNext = false;
            break;
          }
          allTweets.push(...result.tweets.slice(0, remaining));
        } else {
          allTweets.push(...result.tweets);
        }

        showStatus(`正在获取第 ${page} 页...（已获取 ${allTweets.length} 条）`);

        // 检查是否达到目标数量
        if (scope === 'recent' && count && allTweets.length >= count) {
          hasNext = false;
        } else if (!result.hasNextPage) {
          hasNext = false;
        } else {
          page++;
          // 请求间隔，避免触发反爬限制
          await sleep(1500);
        }
      } catch (e) {
        console.log('[微博插件] 获取第', page, '页失败:', e);
        hasNext = false;
      }
    }

    return allTweets;
  }

  // 调用微博移动端 API 获取推文
  async function fetchTweetsFromApi(uid, page) {
    const containerid = `107603${uid}`;
    const apiUrl = `https://m.weibo.cn/api/container/getIndex?containerid=${containerid}&page=${page}`;

    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.ok !== 1) {
      throw new Error('API 返回异常，请确保已登录微博');
    }

    const tweets = [];
    const cards = data.data?.cards || [];

    for (const card of cards) {
      // card_type 9 表示微博内容
      if (card.card_type !== 9 || !card.mblog) continue;

      const mblog = card.mblog;

      // 获取纯文本内容
      let content = mblog.text_raw || stripHtml(mblog.text || '');
      if (!content) continue;

      // 格式化时间
      const time = formatWeiboTime(mblog.created_at);

      tweets.push({ content, time });
    }

    // 判断是否有下一页
    const hasNextPage = tweets.length > 0 && page < (data.data?.cardlistInfo?.total || 0) / 10;

    return { tweets, hasNextPage };
  }

  // 去除 HTML 标签
  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  // 格式化微博时间
  function formatWeiboTime(timeStr) {
    if (!timeStr) return '';

    // 如果是 Unix 时间戳（纯数字）
    if (/^\d+$/.test(timeStr)) {
      const date = new Date(parseInt(timeStr) * 1000);
      return formatDate(date);
    }

    // 相对时间处理
    const now = new Date();

    // "刚刚"
    if (timeStr === '刚刚') {
      return formatDate(now);
    }

    // "X分钟前"
    let match = timeStr.match(/(\d+)分钟前/);
    if (match) {
      const d = new Date(now.getTime() - parseInt(match[1]) * 60 * 1000);
      return formatDate(d);
    }

    // "X小时前"
    match = timeStr.match(/(\d+)小时前/);
    if (match) {
      const d = new Date(now.getTime() - parseInt(match[1]) * 3600 * 1000);
      return formatDate(d);
    }

    // "昨天 HH:MM"
    match = timeStr.match(/昨天\s*(\d{1,2}):(\d{2})/);
    if (match) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
      return formatDate(d);
    }

    // "MM-DD HH:MM"（当年）
    match = timeStr.match(/^(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})$/);
    if (match) {
      const d = new Date(now.getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]),
        parseInt(match[3]), parseInt(match[4]), 0);
      return formatDate(d);
    }

    // "YYYY-MM-DD HH:MM"
    match = timeStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})$/);
    if (match) {
      return `${match[1]}-${pad(match[2])}-${pad(match[3])} ${pad(match[4])}:${pad(match[5])}`;
    }

    // 尝试直接解析为 Date 对象（处理 "Sun Jul 01 12:00:00 +0800 2015" 等格式）
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
      return formatDate(parsed);
    }

    // 其他格式直接返回
    return timeStr;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${y}-${m}-${d} ${h}:${min}`;
  }

  // 生成 Markdown 内容
  function generateMarkdown(tweets) {
    const now = new Date();

    // 按日期分组
    const grouped = {};
    for (const tweet of tweets) {
      const date = tweet.time ? tweet.time.split(' ')[0] : '未知日期';
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(tweet);
    }

    let md = '';
    md += '<!-- 微博云端往事 -->\n\n';
    md += '# 📝 微博云端往事\n\n';
    md += '> 📅 导出时间：' + now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '\n\n';
    md += '> 📊 共 ' + tweets.length + ' 条推文\n\n';
    md += '---\n\n';

    for (const [date, items] of Object.entries(grouped)) {
      md += `**${date}**\n\n`;

      for (const tweet of items) {
        const time = tweet.time ? tweet.time.split(' ')[1] || '' : '';
        const content = tweet.content
          .replace(/转@(\S+)/g, '**转@$1**')
          .replace(/@(\S+)/g, '@$1');

        md += `_${time || '未知时间'}_\n\n`;
        md += `${content}\n\n`;
      }

      md += '---\n\n';
    }

    return md;
  }

  // 生成 HTML (可打印为 PDF)
  function generateHTML(tweets) {
    const now = new Date();

    // 按日期分组
    const grouped = {};
    for (const tweet of tweets) {
      const date = tweet.time ? tweet.time.split(' ')[0] : '未知日期';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(tweet);
    }

    let itemsHtml = '';
    for (const [date, items] of Object.entries(grouped)) {
      itemsHtml += `<h2>${date}</h2>`;
      for (const tweet of items) {
        const time = tweet.time ? tweet.time.split(' ')[1] || '' : '';
        const content = tweet.content
          .replace(/转@(\S+)/g, '<strong>转@$1</strong>')
          .replace(/\n/g, '<br>');
        itemsHtml += `<div class="tweet"><span class="time">${time}</span><p>${content}</p></div>`;
      }
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>微博云端往事</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.6; }
  h1 { text-align: center; font-size: 24px; margin-bottom: 8px; }
  .info { text-align: center; color: #888; font-size: 14px; margin-bottom: 30px; }
  h2 { font-size: 16px; color: #ff8200; border-bottom: 2px solid #ff8200; padding-bottom: 4px; margin: 30px 0 16px; }
  .tweet { padding: 12px 0; border-bottom: 1px solid #eee; }
  .tweet .time { font-size: 12px; color: #999; }
  .tweet p { margin-top: 4px; font-size: 14px; }
  @media print { body { padding: 20px; } .tweet { page-break-inside: avoid; } }
</style>
</head>
<body>
<h1>微博云端往事</h1>
<div class="info">导出时间：${now.toLocaleString('zh-CN')} ｜ 共 ${tweets.length} 条推文</div>
${itemsHtml}
</body>
</html>`;
  }

  function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function showStatus(text) {
    statusDiv.classList.remove('hidden');
    statusDiv.querySelector('.status-text').textContent = text;
    errorDiv.classList.add('hidden');
  }

  function hideStatus() {
    statusDiv.classList.add('hidden');
  }

  function showError(text) {
    errorDiv.textContent = text;
    errorDiv.classList.remove('hidden');
    statusDiv.classList.add('hidden');
  }

  function hideError() {
    errorDiv.classList.add('hidden');
  }
});
