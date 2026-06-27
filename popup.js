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

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url || !tab.url.includes('weibo.com')) {
        throw new Error('请先打开微博网站 (weibo.com)');
      }

      const userId = getUserIdFromUrl(tab.url);
      if (!userId) {
        throw new Error('无法获取用户 ID，请确保在用户主页上（如 weibo.com/u/2028563263），自己主页，或者某个人的主页。');
      }

      const tweets = await fetchAllTweets(tab.id, userId, scope, count);

      if (!tweets || tweets.length === 0) {
        throw new Error('未找到推文，请确保已登录微博');
      }

      showStatus(`已获取 ${tweets.length} 条推文，正在生成文件...`);

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

  function getUserIdFromUrl(url) {
    const match = url.match(/weibo\.com\/u\/(\d+)/);
    return match ? match[1] : null;
  }

  async function fetchAllTweets(tabId, userId, scope, count) {
    const allTweets = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      showStatus(`正在获取第 ${page} 页...（已获取 ${allTweets.length} 条）`);

      try {
        const result = await fetchTweetsFromApi(tabId, userId, page);

        if (!result.tweets || result.tweets.length === 0) {
          hasNext = false;
          break;
        }

        if (scope === 'recent' && count) {
          const remaining = count - allTweets.length;
          if (remaining <= 0) { hasNext = false; break; }
          allTweets.push(...result.tweets.slice(0, remaining));
        } else {
          allTweets.push(...result.tweets);
        }

        showStatus(`正在获取第 ${page} 页...（已获取 ${allTweets.length} 条）`);

        if (scope === 'recent' && count && allTweets.length >= count) {
          hasNext = false;
        } else if (!result.hasNextPage) {
          hasNext = false;
        } else {
          page++;
          await sleep(1500);
        }
      } catch (e) {
        throw new Error('获取第 ' + page + ' 页失败: ' + e.message);
      }
    }

    return allTweets;
  }

  // 调用微博 API：通过 chrome.debugger 在页面上下文中执行 fetch（与控制台同等权限）
  async function fetchTweetsFromApi(tabId, uid, page) {
    const apiUrl = `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=${page}&feature=0`;

    // attach debugger
    await chrome.debugger.attach({ tabId }, '1.3');

    try {
      // 通过 Runtime.evaluate 在页面上下文执行 fetch
      const expression = `
        new Promise((resolve, reject) => {
          fetch("${apiUrl}", { credentials: "include" })
            .then(r => r.text())
            .then(t => resolve(t))
            .catch(e => reject(e.message));
        })
      `;

      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true }
      );

      const raw = result.result?.value;
      if (!raw) throw new Error('API 返回为空，请确保已登录微博');

      const data = JSON.parse(raw);
      if (!data.data) throw new Error('API 返回异常: ' + raw.substring(0, 200));

      const tweets = [];
      // PC API 返回 data.list
      for (const item of (data.data.list || data.data.statuses || [])) {
        let content = item.text_raw || stripHtml(item.text || '');
        if (!content) continue;
        tweets.push({ content, time: formatWeiboTime(item.created_at) });
      }

      const hasNextPage = tweets.length > 0 && data.data.list && data.data.list.length >= 20;
      return { tweets, hasNextPage };
    } finally {
      // 始终 detach debugger
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  function formatWeiboTime(timeStr) {
    if (!timeStr) return '';

    if (/^\d+$/.test(timeStr)) {
      const date = new Date(parseInt(timeStr) * 1000);
      return formatDate(date);
    }

    const now = new Date();

    if (timeStr === '刚刚') return formatDate(now);

    let match = timeStr.match(/(\d+)分钟前/);
    if (match) return formatDate(new Date(now.getTime() - parseInt(match[1]) * 60 * 1000));

    match = timeStr.match(/(\d+)小时前/);
    if (match) return formatDate(new Date(now.getTime() - parseInt(match[1]) * 3600 * 1000));

    match = timeStr.match(/昨天\s*(\d{1,2}):(\d{2})/);
    if (match) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
      return formatDate(d);
    }

    match = timeStr.match(/^(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})$/);
    if (match) {
      return formatDate(new Date(now.getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]),
        parseInt(match[3]), parseInt(match[4]), 0));
    }

    match = timeStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})$/);
    if (match) {
      return `${match[1]}-${pad(match[2])}-${pad(match[3])} ${pad(match[4])}:${pad(match[5])}`;
    }

    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) return formatDate(parsed);

    return timeStr;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function generateMarkdown(tweets) {
    const now = new Date();
    const grouped = {};
    for (const tweet of tweets) {
      const date = tweet.time ? tweet.time.split(' ')[0] : '未知日期';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(tweet);
    }

    let md = '<!-- 微博云端往事 -->\n\n# 📝 微博云端往事\n\n';
    md += `> 📅 导出时间：${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}\n\n`;
    md += `> 📊 共 ${tweets.length} 条推文\n\n---\n\n`;

    for (const [date, items] of Object.entries(grouped)) {
      md += `**${date}**\n\n`;
      for (const tweet of items) {
        const time = tweet.time ? tweet.time.split(' ')[1] || '' : '';
        const content = tweet.content.replace(/转@(\S+)/g, '**转@$1**').replace(/@(\S+)/g, '@$1');
        md += `_${time || '未知时间'}_\n\n${content}\n\n---\n\n`;
      }
    }
    return md;
  }

  function generateHTML(tweets) {
    const now = new Date();
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
        const content = tweet.content.replace(/转@(\S+)/g, '<strong>转@$1</strong>').replace(/\n/g, '<br>');
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

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function showStatus(text) {
    statusDiv.classList.remove('hidden');
    statusDiv.querySelector('.status-text').textContent = text;
    errorDiv.classList.add('hidden');
  }

  function hideStatus() { statusDiv.classList.add('hidden'); }

  function showError(text) {
    errorDiv.textContent = text;
    errorDiv.classList.remove('hidden');
    statusDiv.classList.add('hidden');
  }

  function hideError() { errorDiv.classList.add('hidden'); }
});
