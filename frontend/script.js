// frontend/script.js

let currentReply = null;
let currentChatId = null;
let socket = null;
const API_BASE = '/api'; // будет использовать тот же протокол и домен, что и сайт
const WS_URL = window.location.origin; // например, https://your-domain.com  
let allChats = []; // хранит все чаты
let isMobile = window.innerWidth <= 768;
let isSidebarOpen = false;
let isSending = false; 

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const profileHeader = document.getElementById('profileHeader');
const chatList = document.getElementById('chatList');
const chatHeader = document.getElementById('chatHeader');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');

// ========== DRAG & DROP для изображений ==========
let isDraggingOverMessages = false;

function handleDragOver(e) {
  e.preventDefault(); // Необходимо для срабатывания drop
  e.stopPropagation();
  if (!currentChatId) return; // Не делать ничего, если чат не выбран
  isDraggingOverMessages = true;
  // Добавляем визуальный индикатор перетаскивания
  messagesContainer.classList.add('drag-over');
}

function handleDragEnter(e) {
  e.preventDefault(); // Необходимо для срабатывания drop
  e.stopPropagation();
  if (!currentChatId) return;
  // Проверяем, действительно ли элемент перешёл внутрь (а не просто в дочерний)
  const currentTarget = e.currentTarget;
  const relatedTarget = e.relatedTarget;

  if (!currentTarget.contains(relatedTarget)) {
    isDraggingOverMessages = true;
    messagesContainer.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  // Проверяем, действительно ли элемент покинул контейнер
  const currentTarget = e.currentTarget;
  const relatedTarget = e.relatedTarget;

  if (!currentTarget.contains(relatedTarget)) {
    isDraggingOverMessages = false;
    // Убираем индикатор только если мы *точно* покинули область
    // Но т.к. это сложно точно определить, уберем с задержкой
    setTimeout(() => {
      if (!isDraggingOverMessages) {
         messagesContainer.classList.remove('drag-over');
      }
    }, 100); // Небольшая задержка, чтобы не мигало
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  messagesContainer.classList.remove('drag-over');
  isDraggingOverMessages = false;

  if (!currentChatId) return; // Не делать ничего, если чат не выбран

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('image/')) {
      handleFile(file);
    } else {
      alert('Можно отправлять только изображения');
    }
  }
}
// ========== /DRAG & DROP ==========

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  if (token) {
    initApp(token);
  } else {
    showLogin();
  }

  // Обработка изменения размера окна
  window.addEventListener('resize', () => {
    isMobile = window.innerWidth <= 768;
    // Если на мобильном и открыт чат — обновить вид
    if (isMobile && currentChatId) {
      document.querySelector('.sidebar').classList.add('hidden');
      document.querySelector('.main').classList.add('chat-open');
    } else if (isMobile && !currentChatId) {
      document.querySelector('.sidebar').classList.remove('hidden');
      document.querySelector('.main').classList.remove('chat-open');
    }
  });
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

function openSidebar() {
  document.querySelector('.sidebar').classList.remove('hidden');
  document.querySelector('.main').classList.add('overlay');
  isSidebarOpen = true;
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.add('hidden');
  document.querySelector('.main').classList.remove('overlay');
  isSidebarOpen = false;
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

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // ========== ИНИЦИАЛИЗАЦИЯ DRAG & DROP ==========
  // Убедитесь, что messagesContainer действительно тот, куда перетаскиваются файлы
  // Обычно это контейнер с сообщениями, но может быть и другой элемент
  if (messagesContainer) {
    messagesContainer.addEventListener('dragover', handleDragOver);
    messagesContainer.addEventListener('dragenter', handleDragEnter);
    messagesContainer.addEventListener('dragleave', handleDragLeave);
    messagesContainer.addEventListener('drop', handleDrop);
  } else {
     console.error('messagesContainer элемент не найден для drag & drop!');
  }
  // ========== /ИНИЦИАЛИЗАЦИЯ DRAG & DROP ==========

  socket = io(WS_URL, {
    auth: { token }
  });

  socket.on('connect', () => {
    console.log('WebSocket подключён');
  });

  socket.on('newChatCreated', (chat) => {
    const token = localStorage.getItem('token');
    fetch(`${API_BASE}/chats/${chat.id}/members`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(members => {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const other = members.find(m => m.id != currentUser.id);
      const displayName = other ? (other.name || other.username) : 'Пользователь';

      const chatEl = document.createElement('div');
      chatEl.className = 'chat-item';
      chatEl.setAttribute('data-chat-id', chat.id);
      chatEl.innerHTML = `
        <div class="chat-item-content">
          <strong>${escapeHtml(displayName)}</strong>
          <small></small>
        </div>
      `;
      chatEl.onclick = () => openChat(chat.id, displayName);
      chatList.appendChild(chatEl);
    })
    .catch(e => console.error('Ошибка загрузки участников чата:', e));

    if (Notification.permission === "granted") {
      new Notification('Новый чат', {
        body: `С вами создан чат`
      });
    }
  });

  socket.on('unreadCountUpdated', (data) => {
    updateUnreadCount(data.chatId, data.count);
  });

  socket.on('chatDeleted', (data) => {
    const chatEl = document.querySelector(`.chat-item[data-chat-id="${data.chatId}"]`);
    if (chatEl) {
      chatEl.remove();
      if (currentChatId == data.chatId) {
        currentChatId = null;
        updateChatView();
      }
    }
  });

  socket.on('newMessage', (msg) => {
    if (msg.chat_id != currentChatId) {
      showNotification(msg);
    }

    if (msg.chat_id == currentChatId) {
      addMessageToUI(msg);

      const token = localStorage.getItem('token');
      fetch(`${API_BASE}/chats/${msg.chat_id}/mark-as-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }).then(() => {
        updateUnreadCount(msg.chat_id, 0);
      }).catch(e => console.error('Ошибка при авто-обновлении статуса прочтения:', e));
    } else {
      markChatAsUnread(msg.chat_id);
    }
  });

  socket.on('typing', (data) => {
    if (!currentChatId || data.chatId != currentChatId) return;
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    if (data.userId == currentUser.id) return;
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

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const updatedUser = { ...user, name: profile.name, avatar: profile.avatar };
    localStorage.setItem('user', JSON.stringify(updatedUser));

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

    const unreadRes = await fetch(`${API_BASE}/chats/unread-counts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const unreadCounts = await unreadRes.json();

    allChats = chats;
    chatList.innerHTML = '';

    for (const chat of chats) {
      let displayName = chat.name;

      if (!chat.is_group) {
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
      el.setAttribute('data-chat-id', chat.id);

      const unreadCount = unreadCounts[chat.id] || 0;
      const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';

      el.innerHTML = `
        <div class="chat-item-content">
          <strong>${escapeHtml(displayName)}</strong>
          <small>${chat.lastMsg || ''}</small>
        </div>
        ${unreadBadge}
      `;
      el.onclick = () => openChat(chat.id, displayName);
      chatList.appendChild(el);
    }
  } catch (e) {
    console.error('Ошибка загрузки чатов', e);
  }
}

function updateUnreadCount(chatId, count) {
  const chatEl = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
  if (!chatEl) return;

  const badge = chatEl.querySelector('.unread-badge');
  if (count > 0) {
    if (badge) {
      badge.innerText = count;
    } else {
      const content = chatEl.querySelector('.chat-item-content');
      const newBadge = document.createElement('span');
      newBadge.className = 'unread-badge';
      newBadge.innerText = count;
      chatEl.appendChild(newBadge);
    }
  } else {
    if (badge) badge.remove();
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
      loadChats();
    } else {
      const err = await res.json();
      alert('Ошибка: ' + (err.error || 'Не удалось создать чат'));
    }
  } catch (e) {
    alert('Ошибка подключения');
  }
}

let pendingFile = null;

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Пожалуйста, выберите изображение (jpg, png, gif и т.д.)');
    return;
  }
  pendingFile = file;
  const input = document.getElementById('messageInput');
  input.placeholder = `📷 ${file.name} (нажмите Отправить)`;
  input.value = '';
  input.focus(); // Фокус на поле ввода
}

// Изменённая функция handleFile для использования pendingFile
function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Пожалуйста, выберите изображение');
    return;
  }
  // Устанавливаем файл как "ожидающий отправку", как это делает handleFileSelect
  pendingFile = file;
  const input = document.getElementById('messageInput');
  input.placeholder = `📷 ${file.name} (нажмите Отправить)`;
  input.value = '';
  // Фокус на поле ввода, чтобы было понятно, что файл выбран
  input.focus();
}

async function sendMessage() {
  // 🔐 Проверяем, идёт ли уже отправка
  if (isSending) return;

  const text = messageInput.value.trim();

  // 🔐 Проверяем, выбран ли чат
  if (!currentChatId) return;

  const token = localStorage.getItem('token');

  // 🔸 Если есть файл — отправляем его
  if (pendingFile) {
    // 🔐 Устанавливаем флаг отправки
    isSending = true;

    // 🔐 Показываем индикатор загрузки
    const fileId = Date.now(); // уникальный ID для файла
    showFileUploadProgress(fileId, pendingFile.name);

    const formData = new FormData();
    formData.append('chatId', currentChatId);
    formData.append('file', pendingFile);

    // 🔐 Сбрасываем pendingFile, чтобы нельзя было отправить снова
    pendingFile = null;

    try {
      const res = await fetch(`${API_BASE}/messages/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        resetFileInput();
        messageInput.value = '';
        // Удаляем индикатор загрузки
        removeFileUploadProgress(fileId);
        // Перезагружаем сообщения, чтобы показать новое
        loadMessages(currentChatId);
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось отправить изображение'));
        removeFileUploadProgress(fileId);
      }
    } catch (e) {
      alert('Ошибка подключения');
      removeFileUploadProgress(fileId);
    } finally {
      // 🔐 Сбрасываем флаг в любом случае (успех или ошибка)
      isSending = false;
    }
    return;
  }

  // 🔸 Если текст — отправляем как обычно
  if (text) {
    isSending = true;

    try {
      const payload = { chatId: currentChatId, text };
      if (currentReply) {
        payload.reply_to = currentReply.id;
      }
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        messageInput.value = '';
        cancelReply(); // сбросить цитату
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось отправить'));
      }
    } catch (e) {
      alert('Ошибка подключения');
    } finally {
      isSending = false;
    }
  }
}

function showFileUploadProgress(fileId, fileName) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const el = document.createElement('div');
  el.className = `message out`;
  el.setAttribute('data-message-id', `upload-${fileId}`);
  el.innerHTML = `
    <div class="msg-bubble">
      <div class="upload-progress">
        <div class="upload-text">📤 ${escapeHtml(fileName)}</div>
        <div class="upload-bar">
          <div class="upload-bar-fill"></div>
        </div>
      </div>
    </div>
  `;
  messagesContainer.appendChild(el);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeFileUploadProgress(fileId) {
  const el = document.querySelector(`.message[data-message-id="upload-${fileId}"]`);
  if (el) el.remove();
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
      loadChats();
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

// ========== АДАПТИВНОСТЬ ==========
function updateChatView() {
  const hasChat = !!currentChatId;

  if (isMobile) {
    if (hasChat) {
      document.querySelector('.sidebar').classList.add('hidden');
      document.querySelector('.main').classList.remove('overlay');
      document.querySelector('.main').classList.add('chat-open');
    } else {
      document.querySelector('.sidebar').classList.remove('hidden');
      document.querySelector('.main').classList.remove('overlay');
      document.querySelector('.main').classList.remove('chat-open');
    }
  } else {
    // На десктопе как раньше
    document.querySelector('.messages').style.display = hasChat ? 'flex' : 'none';
    document.querySelector('.input-area').style.display = hasChat ? 'flex' : 'none';
    document.getElementById('chatHeader').innerText = hasChat ? 'Загрузка...' : 'Nee-chat';
  }
}

// Функция возврата к списку чатов (для мобильных)
function backToChats() {
  if (isMobile) {
    document.querySelector('.sidebar').classList.remove('hidden');
    document.querySelector('.main').classList.remove('chat-open');
    currentChatId = null;
    updateChatView();
  }
}

// Вызывается при запуске и при смене чата
async function openChat(chatId, fallbackName) {
  currentChatId = chatId;
  updateChatView();
  document.getElementById('typingIndicator').style.display = 'none';

  // 🔹 Специальная обработка "Общего чата"
  if (fallbackName === 'Общий чат') {
    chatHeader.innerHTML = `
      <button class="back-btn" id="backToChats" onclick="backToChats()" style="display:none;">←</button>
      <span class="chat-header-name">Общий чат</span>
    `;
    const attachmentsBtn = document.createElement('button');
    attachmentsBtn.className = 'attachments-btn';
    attachmentsBtn.title = 'Медиафайлы';
    attachmentsBtn.innerHTML = '🖼️';
    attachmentsBtn.onclick = () => openAttachmentsModal(chatId);
    chatHeader.appendChild(attachmentsBtn);

    messagesContainer.innerHTML = '';
    await loadMessages(chatId);

    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/chats/${chatId}/mark-as-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
    } catch (e) {
      console.error('Ошибка при обновлении статуса прочтения:', e);
    }
    updateUnreadCount(chatId, 0);

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
      displayName = other.name || other.username;
      if (other.avatar && other.avatar.startsWith('http')) {
        avatarHtml = `<img src="${other.avatar}" class="chat-header-avatar" onerror="this.style.display='none'">`;
      } else {
        avatarHtml = `<span class="chat-header-avatar-text">${other.avatar || '👤'}</span>`;
      }
      deleteBtnHtml = `<button class="delete-chat-btn" onclick="deleteChat(${chatId})">×</button>`;
    }

    chatHeader.innerHTML = `
      <div class="avatar-with-status">
        ${avatarHtml}
        <span class="online-status"></span>
      <span class="chat-header-name">${escapeHtml(displayName)}</span>
      ${deleteBtnHtml}
      <button class="attachments-btn" onclick="openAttachmentsModal(${chatId})">🖼️</button>
      </div>
    `;

    if (other) {
      checkOnlineStatus(other.id).then(isOnline => {
        const statusEl = chatHeader.querySelector('.online-status');
        if (statusEl) {
          statusEl.className = `online-status ${isOnline ? 'online' : ''}`;
        }
      });
    }

  } catch (e) {
    console.error('Ошибка открытия чата:', e);
    chatHeader.innerHTML = `<span>${escapeHtml(fallbackName)}</span>`;
  }

  try {
    await fetch(`${API_BASE}/chats/${chatId}/mark-as-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
  } catch (e) {
    console.error('Ошибка при обновлении статуса прочтения:', e);
  }
  updateUnreadCount(chatId, 0);

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

    // Фильтруем сообщения, текст которых является URL-адресом изображения
    // Теперь проверяем и http://, и /uploads/
    const images = messages.filter(msg => (
      (msg.text.startsWith('http') || msg.text.startsWith('/uploads/')) &&
      msg.text.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
    ));

    const grid = document.getElementById('attachmentsGrid');
    grid.innerHTML = '';

    if (images.length === 0) {
      grid.innerHTML = '<p>Нет медиафайлов</p>';
    } else {
      images.forEach(msg => {
        const img = document.createElement('img');
        img.src = msg.text; // Используем URL из сообщения
        img.onclick = () => {
          const fakeImg = {
            dataset: {
              fullsize: msg.text,
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
    console.error('Ошибка загрузки вложений:', e);
    alert('Не удалось загрузить вложения');
  }
}


// Убираем старые функции onDragOver, onDragLeave, onDrop
// messageInput.addEventListener('paste', (e) => {
//   if (!currentChatId) return;
//   const items = e.clipboardData.items;
//   for (let i = 0; i < items.length; i++) {
//     const item = items[i];
//     if (item.type.startsWith('image/')) {
//       const file = item.getAsFile();
//       handleFile(file);
//       e.preventDefault();
//       break;
//     }
//   }
// });

// Обработка вставки изображения из буфера обмена
messageInput.addEventListener('paste', (e) => {
  if (!currentChatId) return;
  const items = e.clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      handleFile(file);
      e.preventDefault();
      break;
    }
  }
});

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

function startReply(message) {
  currentReply = message;
  const replyPreview = document.getElementById('replyPreview');
  if (replyPreview) {
    replyPreview.remove();
  }

  const preview = document.createElement('div');
  preview.id = 'replyPreview';
  preview.className = 'reply-preview';
  preview.innerHTML = `
    <span class="reply-author">${escapeHtml(message.name || 'Пользователь')}:</span>
    <span class="reply-text">${escapeHtml(message.text.length > 50 ? message.text.slice(0, 50) + '...' : message.text)}</span>
    <button class="reply-cancel" onclick="cancelReply()">×</button>
  `;
  document.querySelector('.input-area').insertBefore(preview, messageInput);
  messageInput.focus();
}

function cancelReply() {
  currentReply = null;
  const preview = document.getElementById('replyPreview');
  if (preview) preview.remove();
}

function addMessageToUI(msg) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const isOwn = msg.user_id == currentUser.id;
  const el = document.createElement('div');
  el.className = `message ${isOwn ? 'out' : 'in'}`;
  el.setAttribute('data-message-id', msg.id);

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

  let replyHtml = '';
  if (msg.reply_to) {
    const replyText = msg.reply_text || 'Сообщение удалено';
    const replyName = msg.reply_name || 'Пользователь';
    replyHtml = `
      <div class="reply-quote">
        <strong>${escapeHtml(replyName)}:</strong> ${escapeHtml(replyText)}
      </div>
    `;
  }

  let contentHtml = '';
  let timeHtml = ''; // Время теперь отдельно

  // --- НАЧАЛО: УНИВЕРСАЛЬНАЯ ЛОГИКА ДЛЯ ИЗОБРАЖЕНИЙ/ВИДЕО ---
  // Проверяем, является ли текст сообщения URL-адресом изображения или видео
  // Теперь проверяем и http://, и /uploads/
  const isMediaUrl = (
    msg.text.startsWith('http') || 
    msg.text.startsWith('/uploads/')
  ) && (
    msg.text.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || // Изображения
    msg.text.match(/\.(mp4|webm)(\?.*)?$/i)                 // Видео
  );

  if (isMediaUrl) {
    // Это медиафайл (изображение или видео)
    if (msg.text.match(/\.(mp4|webm)(\?.*)?$/i)) {
      // Видео
      contentHtml = `
        <video controls class="message-video" poster="https://via.placeholder.com/300x200?text=Видео">
          <source src="${msg.text}" type="video/mp4">
          Ваш браузер не поддерживает видео.
        </video>
      `;
    } else {
      // Изображение
      contentHtml = `
        <img
          src="${msg.text}"
          class="message-image"
          data-fullsize="${msg.text}"
          data-sender="${escapeHtml(msg.name || 'Пользователь')}"
          data-timestamp="${msg.created_at}"
          onclick="openImageModal(this)"
        >
      `;
    }
    // Время отображаем под изображением/видео
    timeHtml = `<small class="msg-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>`;
  } else {
    // Обычный текст
    contentHtml = `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
    // Время отображаем после текста
    timeHtml = `<small class="msg-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>`;
  }
  // --- КОНЕЦ: УНИВЕРСАЛЬНАЯ ЛОГИКА ---

  let deleteBtn = '';
  if (isOwn) {
    deleteBtn = `<button class="delete-btn" onclick="deleteMessage(${msg.id})">×</button>`;
  }

  // --- НАЧАЛО: НОВАЯ СТРУКТУРЫ HTML ---
  el.innerHTML = `
    ${avatarHtml}
    <div class="msg-bubble">
      ${authorHtml}
      ${replyHtml}
      ${contentHtml}
      ${timeHtml}
    </div>
    ${deleteBtn}
  `;
  // --- КОНЕЦ: НОВАЯ СТРУКТУРЫ HTML ---

  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.delete-btn, .delete-btn *')) return;
    startReply(msg);
  });

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

  document.getElementById('fullImage').src = url;
  document.getElementById('imageInfo').innerText = `${sender}, ${timestamp}`;

  document.getElementById('imageModal').classList.add('active');
  document.body.style.overflow = 'hidden';

  document.getElementById('modalPrevBtn').style.display = currentIndex > 0 ? 'flex' : 'none';
  document.getElementById('modalNextBtn').style.display = currentIndex < images.length - 1 ? 'flex' : 'none';
}

function closeImageModal() {
  document.getElementById('imageModal').classList.remove('active');
  document.body.style.overflow = '';
}


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

// Горячие клавиши
document.addEventListener('keydown', (e) => {
  const isInputFocused = document.activeElement === messageInput;

  if (isInputFocused && e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
    return;
  }

  if (isInputFocused && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }

  if (e.key === 'Escape') {
    if (document.getElementById('imageModal').classList.contains('active')) {
      closeImageModal();
      return;
    }

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
  const notif = localStorage.getItem('notifications') !== 'false';
  const theme = localStorage.getItem('theme') || 'light';
  document.getElementById('notifCheck').checked = notif;
  document.getElementById('themeSelect').value = theme;
  document.getElementById('settingsModal').classList.add('active');
}

function saveSettings() {
  const notifications = document.getElementById('notifCheck').checked;
  const theme = document.getElementById('themeSelect').value;

  localStorage.setItem('notifications', notifications);
  localStorage.setItem('theme', theme);

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