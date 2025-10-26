// frontend/script.js

let currentChatId = null;
let socket = null;
const API_BASE = 'http://localhost:3000/api';
const WS_URL = 'http://localhost:3000';

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const profileHeader = document.getElementById('profileHeader');
const chatList = document.getElementById('chatList');
const chatHeader = document.getElementById('chatHeader');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  if (token) {
    initApp(token);
  } else {
    showLogin();
  }
});

// ========== ЭКРАН АВТОРИЗАЦИИ ==========
function showLogin() {
  loginScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      initApp(data.token);
    } else {
      alert('Ошибка входа: ' + (data.error || 'Неизвестная ошибка'));
    }
  } catch (e) {
    alert('Ошибка подключения к серверу');
  }
}

async function handleRegister() {
  const username = document.getElementById('regUsername').value;
  const password = document.getElementById('regPassword').value;
  const name = document.getElementById('regName').value;
  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      initApp(data.token);
    } else {
      alert('Ошибка регистрации: ' + (data.error || 'Неизвестная ошибка'));
    }
  } catch (e) {
    alert('Ошибка подключения к серверу');
  }
}

function showNotification(msg) {
  if (Notification.permission !== "granted") return;

  // Получаем имя отправителя из сообщения (оно приходит с бэка)
  const title = msg.name || 'Новое сообщение';
  const text = msg.text.length > 50 ? msg.text.slice(0, 50) + '...' : msg.text;

  new Notification(title, {
    body: text,
    icon: msg.avatar?.startsWith('http') ? msg.avatar : null
  });
}

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========
async function initApp(token) {
  showApp();
  loadProfile();
  loadChats();
  updateChatView(); 
  const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);
  
  // Запрашиваем разрешение на уведомления
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}


  // Подключение WebSocket
  socket = io(WS_URL, {
    auth: { token }
  });

  socket.on('connect', () => {
    console.log('WebSocket подключён');
  });

socket.on('newMessage', (msg) => {
  // Если сообщение не из текущего чата — показываем уведомление
  if (msg.chat_id != currentChatId) {
    showNotification(msg);
  }
  // Всегда добавляем в DOM (если чат открыт позже)
  if (msg.chat_id == currentChatId) {
    addMessageToUI(msg);
  } else {
    markChatAsUnread(msg.chat_id);
  }
});

socket.on('typing', (data) => {
  if (!currentChatId || data.chatId != currentChatId) return;

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  if (data.userId == currentUser.id) return; // это вы — не показываем

  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.style.display = data.typing ? 'block' : 'none';
  }
});


  socket.on('connect_error', (err) => {
    console.error('WebSocket ошибка:', err.message);
  });

}

// ========== ПРОФИЛЬ ==========
async function loadProfile() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const profile = await res.json();
    
    // Сохраняем данные
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const updatedUser = { ...user, name: profile.name, avatar: profile.avatar };
    localStorage.setItem('user', JSON.stringify(updatedUser));

    // Отображаем аватар
    const avatarEl = document.createElement('span');
    const avatarText = profile.avatar.trim();
    if (avatarText.startsWith('http')) {
      avatarEl.innerHTML = `<img src="${escapeHtml(avatarText)}" alt="avatar" class="avatar-img">`;
    } else {
      avatarEl.textContent = avatarText || '👤';
    }
    profileHeader.innerHTML = '';
    profileHeader.appendChild(avatarEl);
    profileHeader.insertAdjacentText('beforeend', ' ' + profile.name);
  } catch (e) {
    console.error('Ошибка загрузки профиля');
  }
}

async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const avatar = document.getElementById('profileAvatar').value.trim() || '👤';
  if (!name) return alert('Укажите имя');

  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name, avatar })
    });
    if (res.ok) {
      loadProfile();
      closeModal('profileModal');
    } else {
      alert('Не удалось сохранить профиль');
    }
  } catch (e) {
    alert('Ошибка подключения');
  }
}

// ========== ЧАТЫ ==========
async function loadChats() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/chats`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const chats = await res.json();
    chatList.innerHTML = '';

    for (const chat of chats) {
      let displayName = chat.name;

      // Если чат приватный — попробуем определить собеседника
      if (!chat.is_group) {
        // Запросим участников чата
        const membersRes = await fetch(`${API_BASE}/chats/${chat.id}/members`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const members = await membersRes.json();
        const other = members.find(m => m.id != JSON.parse(localStorage.getItem('user')).id);
        if (other) {
          displayName = other.name || other.username;
        }
      }

      const el = document.createElement('div');
      el.className = 'chat-item';
      el.innerHTML = `<strong>${escapeHtml(displayName)}</strong><br><small>${chat.lastMsg || ''}</small>`;
      el.onclick = () => openChat(chat.id, displayName);
      chatList.appendChild(el);
    }
  } catch (e) {
    console.error('Ошибка загрузки чатов', e);
  }
}
async function openNewChatModal() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const users = await res.json();
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    if (users.length === 0) {
      list.innerHTML = '<p>Нет других пользователей</p>';
    } else {
      users.forEach(user => {
        const el = document.createElement('div');
        el.className = 'chat-item';
        el.style.cursor = 'pointer';
        el.innerHTML = `<strong>${user.name || user.username}</strong>`;
        el.onclick = () => createPrivateChat(user.id, user.name || user.username);
        list.appendChild(el);
      });
    }

    document.getElementById('newChatModal').classList.add('active');
  } catch (e) {
    alert('Не удалось загрузить пользователей');
  }
}

async function createPrivateChat(userId, name) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/chats/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });
    if (res.ok) {
      closeModal('newChatModal');
      loadChats(); // обновить список чатов
      // Можно автоматически открыть чат:
      // const chat = await res.json();
      // openChat(chat.id, `Чат с ${name}`);
    } else {
      const err = await res.json();
      alert('Ошибка: ' + (err.error || 'Не удалось создать чат'));
    }
  } catch (e) {
    alert('Ошибка подключения');
  }
}

let pendingFile = null; // временно храним выбранный файл

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Пожалуйста, выберите изображение (jpg, png, gif и т.д.)');
    return;
  }

  pendingFile = file;
  // Опционально: показать превью
  const input = document.getElementById('messageInput');
  input.placeholder = `📷 ${file.name} (нажмите Отправить)`;
  input.value = ''; // очищаем текст
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!currentChatId) return;

  const token = localStorage.getItem('token');

  if (pendingFile) {
    // Отправка изображения
    const formData = new FormData();
    formData.append('chatId', currentChatId);
    formData.append('file', pendingFile);

    try {
      const res = await fetch(`${API_BASE}/messages/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        resetFileInput();
        loadMessages(currentChatId); // обновить чат
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось отправить изображение'));
      }
    } catch (e) {
      alert('Ошибка подключения');
    }
  } else if (text) {
    // Отправка текста (старая логика)
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ chatId: currentChatId, text })
      });
      if (res.ok) {
        messageInput.value = '';
      }
    } catch (e) {
      alert('Не удалось отправить сообщение');
    }
  }
}

function resetFileInput() {
  pendingFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('messageInput').placeholder = 'Сообщение...';
}

async function deleteChat(chatId) {
  if (!confirm('Удалить чат? Все сообщения будут потеряны.')) return;

  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/chats/${chatId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      currentChatId = null;
      updateChatView();
      loadChats(); // обновить список
    } else {
      const err = await res.json();
      alert('Ошибка: ' + (err.error || 'Не удалось удалить чат'));
    }
  } catch (e) {
    alert('Ошибка подключения');
  }
}

function markChatAsUnread(chatId) {
  // В реальном приложении — обновляли бы счётчик
  // Здесь просто логика заготовки
}

let typingTimeout = null;

document.getElementById('messageInput').addEventListener('input', () => {
  if (!currentChatId || !socket) return;
  
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  socket.emit('typing', { 
    chatId: currentChatId, 
    typing: true,
    userId: currentUser.id 
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { 
      chatId: currentChatId, 
      typing: false,
      userId: currentUser.id 
    });
  }, 3000);
});

function updateChatView() {
  const hasChat = !!currentChatId;
  document.querySelector('.messages').style.display = hasChat ? 'flex' : 'none';
  document.querySelector('.input-area').style.display = hasChat ? 'flex' : 'none';
  document.querySelector('.main').classList.toggle('has-chat', hasChat);
  document.getElementById('chatHeader').innerText = hasChat ? 'Загрузка...' : 'Nee-chat';
}

// Вызывается при запуске и при смене чата
async function openChat(chatId, fallbackName) {
  currentChatId = chatId;
  updateChatView();
  document.getElementById('typingIndicator').style.display = 'none';
  // 🔹 Специальная обработка "Общего чата"
  if (fallbackName === 'Общий чат') {
    chatHeader.innerHTML = `<span class="chat-header-name">Общий чат</span>`;
    messagesContainer.innerHTML = '';
    await loadMessages(chatId);
    if (socket && socket.connected) {
      socket.emit('joinChat', chatId);
    }
    return;
  }

  // Обычная логика для приватных чатов
  const token = localStorage.getItem('token');
  try {
    const membersRes = await fetch(`${API_BASE}/chats/${chatId}/members`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const members = await membersRes.json();
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const other = members.find(m => m.id != currentUser.id);

    let displayName = fallbackName;
    let avatarHtml = '';
    let deleteBtnHtml = '';


    if (other) {
      avatarHtml = `
        <div class="avatar-with-status">
          ${other.avatar && other.avatar.startsWith('http')
            ? `<img src="${other.avatar}" class="chat-header-avatar" onerror="this.style.display='none'">`
            : `<span class="chat-header-avatar-text">${other.avatar || '👤'}</span>`
          }
          <span class="online-status"></span>
        </div>
      `;
    }


    chatHeader.innerHTML = `
      ${avatarHtml}
      <span class="chat-header-name">${escapeHtml(displayName)}</span>
      ${deleteBtnHtml}
    `;
    // Добавляем кнопку вложений ПОСЛЕ установки innerHTML
    const attachmentsBtn = document.createElement('button');
    attachmentsBtn.className = 'attachments-btn';
    attachmentsBtn.title = 'Медиафайлы';
    attachmentsBtn.innerHTML = '🖼️';
    attachmentsBtn.onclick = () => openAttachmentsModal(chatId);
    chatHeader.appendChild(attachmentsBtn);

    // Теперь запрашиваем статус
    checkOnlineStatus(other.id).then(isOnline => {
      const statusEl = chatHeader.querySelector('.online-status');
      if (statusEl) {
        statusEl.className = `online-status ${isOnline ? 'online' : ''}`;
      }
    });
  } catch (e) {
    chatHeader.innerHTML = `<span>${escapeHtml(fallbackName)}</span>`;
  }

  messagesContainer.innerHTML = '';
  await loadMessages(chatId);

  if (socket && socket.connected) {
    socket.emit('joinChat', chatId);
  }
}

async function checkOnlineStatus(userId) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/users/${userId}/online`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return data.online;
  } catch (e) {
    return false;
  }
}

async function openAttachmentsModal(chatId) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/messages/${chatId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const messages = await res.json();
    const images = messages.filter(msg => msg.text.startsWith('/uploads/'));

    const grid = document.getElementById('attachmentsGrid');
    grid.innerHTML = '';

    if (images.length === 0) {
      grid.innerHTML = '<p>Нет медиафайлов</p>';
    } else {
      images.forEach(msg => {
        const img = document.createElement('img');
        img.src = `http://localhost:3000${msg.text}`;
        img.onclick = () => {
          // Имитируем клик по изображению в чате
          const fakeImg = {
            dataset: {
              fullsize: `http://localhost:3000${msg.text}`,
              sender: msg.name || 'Пользователь',
              timestamp: msg.created_at
            }
          };
          openImageModal(fakeImg);
          closeModal('attachmentsModal');
        };
        grid.appendChild(img);
      });
    }

    document.getElementById('attachmentsModal').classList.add('active');
  } catch (e) {
    alert('Не удалось загрузить вложения');
  }
}

async function loadMessages(chatId) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/messages/${chatId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const messages = await res.json();
    messagesContainer.innerHTML = '';
    messages.forEach(addMessageToUI);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (e) {
    console.error('Ошибка загрузки сообщений');
  }
}

async function deleteMessage(messageId) {
  if (!confirm('Удалить сообщение?')) return;

  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      // Удаляем из DOM
      const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
      if (msgEl) msgEl.remove();
    } else {
      const data = await res.json();
      alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
    }
  } catch (e) {
    alert('Ошибка подключения');
  }
}

function addMessageToUI(msg) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const isOwn = msg.user_id == currentUser.id;

  const el = document.createElement('div');
  el.className = `message ${isOwn ? 'out' : 'in'}`;
  el.setAttribute('data-message-id', msg.id);

  const isImage = msg.text.startsWith('/uploads/');

  // 🔹 ВСЕГДА показываем имя и аватарку для чужих сообщений (включая изображения)
  let authorHtml = '';
  let avatarHtml = '';

  if (!isOwn) {
    authorHtml = `<div class="message-author">${escapeHtml(msg.name || 'Пользователь')}</div>`;
    const avatar = msg.avatar || '👤';
    if (avatar.startsWith('http')) {
      avatarHtml = `<img src="${avatar}" class="message-avatar" onerror="this.style.display='none'">`;
    } else {
      avatarHtml = `<div class="message-avatar-text">${escapeHtml(avatar)}</div>`;
    }
  }

  let contentHtml = '';
  if (isImage) {
    const imgUrl = `http://localhost:3000${msg.text}`;
    // 🔹 Добавляем data-url для открытия в модалке
    contentHtml = `<img src="${imgUrl}" class="message-image" data-fullsize="${imgUrl}" onclick="openImageModal('${imgUrl}')">`;
  } else {
    contentHtml = `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
  }

  let deleteBtn = '';
  if (isOwn) {
    deleteBtn = `<button class="delete-btn" onclick="deleteMessage(${msg.id})">×</button>`;
  }

  if (isImage) {
  const imgUrl = `http://localhost:3000${msg.text}`;
  const timestamp = msg.created_at; // ISO-строка
  const senderName = msg.name || 'Пользователь';
  contentHtml = `
    <img 
      src="${imgUrl}" 
      class="message-image" 
      data-fullsize="${imgUrl}"
      data-sender="${escapeHtml(senderName)}"
      data-timestamp="${timestamp}"
      onclick="openImageModal(this)"
    >
  `;
}

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `
    ${avatarHtml}
    <div class="msg-bubble">
      ${authorHtml}
      ${contentHtml}
      ${isImage ? '' : `<small class="msg-time">${time}</small>`}
    </div>
    ${deleteBtn}
  `;

  messagesContainer.appendChild(el);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showPrevImage(e) {
  e.stopPropagation();
  if (window.currentImageIndex > 0) {
    window.currentImageIndex--;
    const imgData = window.chatImages[window.currentImageIndex];
    document.getElementById('fullImage').src = imgData.url;
    document.getElementById('imageInfo').innerText = `${imgData.sender}, ${imgData.timestamp}`;
    
    // Обновляем видимость стрелок
    document.getElementById('modalPrevBtn').style.display = window.currentImageIndex > 0 ? 'flex' : 'none';
    document.getElementById('modalNextBtn').style.display = 'flex';
  }
}

function showNextImage(e) {
  e.stopPropagation();
  if (window.currentImageIndex < window.chatImages.length - 1) {
    window.currentImageIndex++;
    const imgData = window.chatImages[window.currentImageIndex];
    document.getElementById('fullImage').src = imgData.url;
    document.getElementById('imageInfo').innerText = `${imgData.sender}, ${imgData.timestamp}`;
    
    document.getElementById('modalNextBtn').style.display = window.currentImageIndex < window.chatImages.length - 1 ? 'flex' : 'none';
    document.getElementById('modalPrevBtn').style.display = 'flex';
  }
}

function openImageModal(imgElement) {
  const url = imgElement.dataset.fullsize;
  const sender = imgElement.dataset.sender;
  const timestamp = new Date(imgElement.dataset.timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Собираем все изображения в чате
const images = Array.from(document.querySelectorAll('.message-image'))
  .map(img => ({
    url: img.dataset.fullsize,
    sender: img.dataset.sender || 'Пользователь',
    timestamp: new Date(img.dataset.timestamp).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }));

  const currentIndex = images.findIndex(i => i.url === url);
  window.currentImageIndex = currentIndex;
  window.chatImages = images;

  // Обновляем интерфейс
  document.getElementById('fullImage').src = url;
  document.getElementById('imageInfo').innerText = `${sender}, ${timestamp}`;

  document.getElementById('imageModal').classList.add('active');
  document.body.style.overflow = 'hidden';

  // Обновляем стрелки
  document.getElementById('modalPrevBtn').style.display = currentIndex > 0 ? 'flex' : 'none';
  document.getElementById('modalNextBtn').style.display = currentIndex < images.length - 1 ? 'flex' : 'none';
}

function closeImageModal() {
  document.getElementById('imageModal').classList.remove('active');
  document.body.style.overflow = ''; // вернуть скролл
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!currentChatId) return;

  const token = localStorage.getItem('token');

  // 🔸 Сначала проверяем: есть ли файл?
  if (pendingFile) {
    const formData = new FormData();
    formData.append('chatId', currentChatId);
    formData.append('file', pendingFile);
    // Опционально: можно добавить подпись
    // if (text) formData.append('caption', text);

    try {
      const res = await fetch(`${API_BASE}/messages/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        resetFileInput();
        messageInput.value = ''; // очищаем поле
        loadMessages(currentChatId);
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось отправить изображение'));
      }
    } catch (e) {
      alert('Ошибка подключения');
    }
    return; // 🔴 ВАЖНО: выходим, чтобы не отправлять текст
  }

  // Если файла нет — отправляем текст
  if (text) {
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ chatId: currentChatId, text })
      });
      if (res.ok) {
        messageInput.value = '';
      }
    } catch (e) {
      alert('Не удалось отправить сообщение');
    }
  }
}

// Горячие клавиши
document.addEventListener('keydown', (e) => {
  const isInputFocused = document.activeElement === messageInput;

  // Ctrl + Enter — отправка
  if (isInputFocused && e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
    return;
  }

  // Enter — отправка (для удобства на мобильных / без Ctrl)
  if (isInputFocused && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }

  // Esc — закрыть модалки
  if (e.key === 'Escape') {
    // Закрыть просмотр изображения
    if (document.getElementById('imageModal').classList.contains('active')) {
      closeImageModal();
      return;
    }
    // Закрыть другие модалки
    const modals = ['profileModal', 'settingsModal', 'newChatModal', 'attachmentsModal'];
    for (const id of modals) {
      const modal = document.getElementById(id);
      if (modal && modal.classList.contains('active')) {
        closeModal(id);
        return;
      }
    }
  }
});

function openProfileModal() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  document.getElementById('profileName').value = user.name || '';
  document.getElementById('profileAvatar').value = user.avatar || '👤';
  document.getElementById('profileModal').classList.add('active');
}

function applyTheme(theme) {
  document.body.classList.toggle('dark-theme', theme === 'dark');
}

// ========== НАСТРОЙКИ ==========
function openSettings() {
  // Загрузка текущих настроек (из localStorage или заглушка)
  const notif = localStorage.getItem('notifications') !== 'false';
  const theme = localStorage.getItem('theme') || 'light';
  document.getElementById('notifCheck').checked = notif;
  document.getElementById('themeSelect').value = theme;
  document.getElementById('settingsModal').classList.add('active');
}
function saveSettings() {
  const notifications = document.getElementById('notifCheck').checked;
  const theme = document.getElementById('themeSelect').value;

  // Сохраняем в localStorage
  localStorage.setItem('notifications', notifications);
  localStorage.setItem('theme', theme);

  // Применяем тему
  applyTheme(theme);

  closeModal('settingsModal');
}

function showRegisterForm() {
  document.querySelector('.auth-form').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
}

function showLoginForm() {
  document.getElementById('registerForm').style.display = 'none';
  document.querySelector('.auth-form').style.display = 'block';
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '<',
    '>': '>',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Выход из аккаунта
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showLogin();
  if (socket) socket.disconnect();
  currentChatId = null;
}