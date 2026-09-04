document.documentElement.lang = 'zh-CN';

document.querySelector('#options')?.addEventListener('click', () => void chrome.runtime.openOptionsPage());
