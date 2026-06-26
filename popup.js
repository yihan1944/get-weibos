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

      // 检查是否在饭否页面
      if (!tab.url || !tab.url.includes('fanfou.com')) {
        throw new Error('请先打开饭否网站 (fanfou.com)');
      }

      // 逐页获取推文
      const tweets = await fetchAllTweets(tab.id, tab.url, scope, count);

      if (!tweets || tweets.length === 0) {
        throw new Error('未找到推文，请确保已登录饭否');
      }

      showStatus(`已获取 ${tweets.length} 条推文，正在生成文件...`);

      // 生成文件内容
      let content, filename, mimeType;
      if (format === 'markdown') {
        content = generateMarkdown(tweets);
        filename = `fanfou_tweets_${getDateStr()}.md`;
        mimeType = 'text/markdown';
      } else {
        content = generateHTML(tweets);
        filename = `fanfou_tweets_${getDateStr()}.html`;
        mimeType = 'text/html';
      }

      // 下载文件
      let url;
      if (format === 'pdf') {
        // HTML 使用 data URL
        url = `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
      } else {
        // Markdown 使用 data URL
        url = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
      }

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

  // 从 URL 获取用户 ID
  function getUserIdFromUrl(url) {
    const match = url.match(/fanfou\.com\/([^/]+)/);
    if (match && match[1] && !['home', 'login', 'settings', 'search', 'browse', 'finder'].includes(match[1])) {
      return match[1];
    }
    return null;
  }

  // 逐页获取所有推文
  async function fetchAllTweets(tabId, currentUrl, scope, count) {
    const allTweets = [];
    let page = 1;
    let hasNext = true;
    let userId = getUserIdFromUrl(currentUrl);

    // 第一页：直接从当前页面获取
    showStatus('正在获取第 1 页...');
    const firstResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: fetchCurrentPageTweets,
      args: [{ scope, count: count ? count - allTweets.length : null }]
    });

    const firstData = firstResult[0].result;
    allTweets.push(...firstData.tweets);

    // 如果没有用户 ID，从页面获取
    if (!userId && firstData.userId) {
      userId = firstData.userId;
    }

    showStatus(`已获取 ${allTweets.length} 条推文${scope === 'recent' && count ? `，目标 ${count} 条` : ''}`);

    // 检查是否需要继续
    if (scope === 'recent' && count && allTweets.length >= count) {
      hasNext = false;
    } else if (!firstData.hasNextPage || !userId) {
      hasNext = false;
    } else {
      page++;
    }

    // 获取后续页面
    while (hasNext) {
      showStatus(`正在获取第 ${page} 页...`);

      const pageUrl = `https://fanfou.com/${userId}/p.${page}`;

      const result = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: fetchTweetsFromUrl,
        args: [{ url: pageUrl, scope, count: count ? count - allTweets.length : null }]
      });

      const { tweets, hasNextPage } = result[0].result;
      allTweets.push(...tweets);

      showStatus(`已获取 ${allTweets.length} 条推文${scope === 'recent' && count ? `，目标 ${count} 条` : ''}`);

      if (scope === 'recent' && count && allTweets.length >= count) {
        hasNext = false;
      } else if (!hasNextPage) {
        hasNext = false;
      } else {
        page++;
      }
    }

    return allTweets;
  }

  // 在页面中执行的函数，获取当前页面的推文
  function fetchCurrentPageTweets({ scope, count }) {
    const tweets = [];
    let hasNextPage = false;
    let userId = null;

    // 获取 #stream 元素
    const stream = document.getElementById('stream');
    if (!stream) return { tweets, hasNextPage, userId };

    // 尝试获取用户 ID
    const profileLink = document.querySelector('#sidebar .vcard a[href*="/friends/"], #user_stats a[href*="/friends/"]');
    if (profileLink) {
      const match = profileLink.href.match(/\/friends\/([^/]+)/);
      if (match) userId = match[1];
    }

    // 获取 #stream 下的 li 元素
    const items = stream.querySelectorAll('ol li');

    for (const item of items) {
      if (scope === 'recent' && count && tweets.length >= count) break;

      // 获取内容
      const contentEl = item.querySelector('span.content');
      if (!contentEl) continue;

      let content = contentEl.textContent.trim();
      if (!content) continue;

      // 获取时间
      const timeEl = item.querySelector('a.time');
      let time = '';
      if (timeEl) {
        time = timeEl.getAttribute('title') || timeEl.textContent.trim();
      }

      tweets.push({ content, time });
    }

    // 检查是否有下一页
    const paginator = document.querySelector('.paginator');
    if (paginator) {
      const links = paginator.querySelectorAll('a');
      for (const link of links) {
        if (link.textContent.trim() === '下一页') {
          hasNextPage = true;
          break;
        }
      }
    }

    return { tweets, hasNextPage, userId };
  }

  // 在页面中执行的函数，从 URL 获取推文
  async function fetchTweetsFromUrl({ url, scope, count }) {
    const tweets = [];
    let hasNextPage = false;

    try {
      // 使用 fetch 获取页面内容
      const response = await fetch(url, { credentials: 'include' });
      const html = await response.text();

      // 解析 HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 获取 #stream 元素
      const stream = doc.getElementById('stream');
      if (!stream) return { tweets, hasNextPage };

      // 获取 #stream 下的 li 元素
      const items = stream.querySelectorAll('ol li');

      for (const item of items) {
        if (scope === 'recent' && count && tweets.length >= count) break;

        // 获取内容
        const contentEl = item.querySelector('span.content');
        if (!contentEl) continue;

        let content = contentEl.textContent.trim();
        if (!content) continue;

        // 获取时间
        const timeEl = item.querySelector('a.time');
        let time = '';
        if (timeEl) {
          time = timeEl.getAttribute('title') || timeEl.textContent.trim();
        }

        tweets.push({ content, time });
      }

      // 检查是否有下一页
      const paginator = doc.querySelector('.paginator');
      if (paginator) {
        const links = paginator.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent.trim() === '下一页') {
            hasNextPage = true;
            break;
          }
        }
      }
    } catch (e) {
      console.log('[饭否插件] 获取页面失败:', url, e);
    }

    return { tweets, hasNextPage };
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
    md += '<!-- 饭否美好时光 -->\n\n';
    md += '# 📝 饭否美好时光\n\n';
    md += '> 📅 导出时间：' + now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '\n\n';
    md += '> 📊 共 ' + tweets.length + ' 条推文\n\n';
    md += '---\n\n';

    for (const [date, items] of Object.entries(grouped)) {
      md += `**${date}**\n\n`;

      for (const tweet of items) {
        const time = tweet.time ? tweet.time.split(' ')[1] || '' : '';
        const content = tweet.content
          .replace(/^图片 /, '🖼️ ')
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
<title>饭否美好时光</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.6; }
  h1 { text-align: center; font-size: 24px; margin-bottom: 8px; }
  .info { text-align: center; color: #888; font-size: 14px; margin-bottom: 30px; }
  h2 { font-size: 16px; color: #ff6b00; border-bottom: 2px solid #ff6b00; padding-bottom: 4px; margin: 30px 0 16px; }
  .tweet { padding: 12px 0; border-bottom: 1px solid #eee; }
  .tweet .time { font-size: 12px; color: #999; }
  .tweet p { margin-top: 4px; font-size: 14px; }
  @media print { body { padding: 20px; } .tweet { page-break-inside: avoid; } }
</style>
</head>
<body>
<h1>饭否美好时光</h1>
<div class="info">导出时间：${now.toLocaleString('zh-CN')} ｜ 共 ${tweets.length} 条推文</div>
${itemsHtml}
</body>
</html>`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
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
