const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");
const healthBtn = document.getElementById("healthBtn");
const musicOnly = document.getElementById("musicOnly");

const statusBox = document.getElementById("status");
const resultsBox = document.getElementById("results");
const resultCount = document.getElementById("resultCount");

const playerSection = document.getElementById("playerSection");
const player = document.getElementById("player");
const nowTitle = document.getElementById("nowTitle");
const nowChannel = document.getElementById("nowChannel");
const openYoutube = document.getElementById("openYoutube");

const favoritesBox = document.getElementById("favorites");
const historyBox = document.getElementById("history");
const clearFavsBtn = document.getElementById("clearFavs");
const clearHistoryBtn = document.getElementById("clearHistory");

let currentResults = [];
let activeQueue = [];
let currentIndex = -1;
let ytPlayer = null;
let ytApiPromise = null;

const STORAGE_KEYS = {
  favorites: "yt_super_deus_favorites",
  history: "yt_super_deus_history"
};

function setStatus(message, type = "normal") {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function getStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function setStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeVideo(video) {
  return {
    video_id: video.video_id || "",
    title: video.title || "Sem título",
    channel: video.channel || "YouTube",
    thumb: video.thumb || "",
    duration_text: video.duration_text || "",
    watch_url: video.watch_url || `https://www.youtube.com/watch?v=${video.video_id}`,
    embed_url: video.embed_url || `https://www.youtube.com/embed/${video.video_id}`
  };
}

function makeQueue(list) {
  const seen = new Set();
  const queue = [];

  list.forEach(item => {
    const video = normalizeVideo(item);

    if (!video.video_id) return;
    if (seen.has(video.video_id)) return;

    seen.add(video.video_id);
    queue.push(video);
  });

  return queue;
}

function loadYouTubeIframeAPI() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise(resolve => {
    window.onYouTubeIframeAPIReady = () => {
      resolve();
    };

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";

    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  });

  return ytApiPromise;
}

async function searchVideos() {
  const q = searchInput.value.trim();

  if (!q) {
    setStatus("Escreve primeiro o nome da música, artista ou vídeo.", "warning");
    searchInput.focus();
    return;
  }

  setStatus("A pesquisar no YouTube...", "loading");

  resultsBox.innerHTML = "";
  resultCount.textContent = "0 vídeos";
  currentResults = [];
  activeQueue = [];
  currentIndex = -1;

  searchBtn.disabled = true;
  searchBtn.textContent = "A procurar...";

  try {
    const params = new URLSearchParams({
      q: q,
      music: musicOnly.checked ? "1" : "0"
    });

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    if (!data.ok) {
      setStatus(data.error || "Erro desconhecido na API.", "error");
      renderResults([]);
      return;
    }

    currentResults = data.results || [];

    if (!currentResults.length) {
      setStatus(
        "Nenhum vídeo compatível encontrado. Tenta pesquisar com 'official video' ou desmarca 'Apenas categoria Música'.",
        "warning"
      );
      renderResults([]);
      return;
    }

    setStatus(`Encontrados ${currentResults.length} vídeos compatíveis.`, "success");
    renderResults(currentResults);

  } catch (error) {
    setStatus(`Erro: ${error.message}`, "error");
    renderResults([]);

  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Pesquisar";
  }
}

function renderResults(videos) {
  resultsBox.innerHTML = "";

  resultCount.textContent = `${videos.length} vídeo${videos.length === 1 ? "" : "s"}`;

  if (!videos.length) {
    resultsBox.innerHTML = `
      <div class="empty-state">
        <div>🎧</div>
        <h3>Sem resultados</h3>
        <p>Tenta uma pesquisa mais direta, por exemplo: <b>Adele Hello official video</b></p>
      </div>
    `;
    return;
  }

  videos.forEach((rawVideo, index) => {
    const video = normalizeVideo(rawVideo);

    const card = document.createElement("article");
    card.className = "video-card";

    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="${escapeHtml(video.thumb)}" alt="${escapeHtml(video.title)}" loading="lazy">

        ${video.duration_text ? `<span class="duration">${escapeHtml(video.duration_text)}</span>` : ""}

        <button class="play-overlay" title="Tocar">
          ▶
        </button>
      </div>

      <div class="video-info">
        <h3>${escapeHtml(video.title)}</h3>
        <p>${escapeHtml(video.channel)}</p>
      </div>

      <div class="card-actions">
        <button class="play-btn">Tocar</button>
        <button class="fav-btn">Favorito</button>
      </div>
    `;

    card.querySelector(".play-overlay").addEventListener("click", () => {
      playVideo(video, currentResults, false);
    });

    card.querySelector(".play-btn").addEventListener("click", () => {
      playVideo(video, currentResults, false);
    });

    card.querySelector(".fav-btn").addEventListener("click", () => {
      addFavorite(video);
    });

    if (index === 0) {
      card.classList.add("first-card");
    }

    resultsBox.appendChild(card);
  });
}

async function playVideo(rawVideo, queue = null, autoNext = false) {
  const video = normalizeVideo(rawVideo);

  if (!video.video_id) {
    setStatus("Este vídeo não tem ID válido.", "error");
    return;
  }

  if (queue && queue.length) {
    activeQueue = makeQueue(queue);
  } else if (!activeQueue.length) {
    activeQueue = makeQueue(currentResults.length ? currentResults : [video]);
  }

  currentIndex = activeQueue.findIndex(item => item.video_id === video.video_id);

  if (currentIndex === -1) {
    activeQueue.unshift(video);
    currentIndex = 0;
  }

  playerSection.classList.remove("hidden");

  nowTitle.textContent = video.title;
  nowChannel.textContent = video.channel;
  openYoutube.href = video.watch_url;

  player.innerHTML = `<div id="ytPlayerBox"></div>`;

  await loadYouTubeIframeAPI();

  if (ytPlayer && typeof ytPlayer.destroy === "function") {
    try {
      ytPlayer.destroy();
    } catch {}
  }

  ytPlayer = new YT.Player("ytPlayerBox", {
    width: "100%",
    height: "100%",
    videoId: video.video_id,
    host: "https://www.youtube.com",
    playerVars: {
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: window.location.origin
    },
    events: {
      onReady: event => {
        event.target.playVideo();
      },
      onStateChange: handlePlayerStateChange,
      onError: handlePlayerError
    }
  });

  addHistory(video);

  if (autoNext) {
    setStatus("A tocar automaticamente a próxima música da playlist.", "success");
  } else {
    setStatus("Vídeo carregado. Quando terminar, toca automaticamente o próximo.", "success");
  }

  if (!autoNext) {
    setTimeout(() => {
      playerSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 120);
  }
}

function handlePlayerStateChange(event) {
  if (!window.YT || !window.YT.PlayerState) return;

  if (event.data === YT.PlayerState.ENDED) {
    playNextVideo();
  }
}

function handlePlayerError(event) {
  console.warn("Erro no player do YouTube:", event.data);

  setStatus("Este vídeo falhou ou está indisponível. A passar para o próximo...", "warning");

  setTimeout(() => {
    playNextVideo();
  }, 900);
}

function playNextVideo() {
  if (!activeQueue.length) {
    setStatus("Não existe playlist ativa.", "warning");
    return;
  }

  const nextIndex = currentIndex + 1;

  if (nextIndex >= activeQueue.length) {
    setStatus("A playlist terminou.", "success");
    return;
  }

  const nextVideo = activeQueue[nextIndex];

  currentIndex = nextIndex;

  playVideo(nextVideo, activeQueue, true);
}

function addFavorite(rawVideo) {
  const video = normalizeVideo(rawVideo);

  let favorites = getStorage(STORAGE_KEYS.favorites);

  favorites = favorites.filter(item => item.video_id !== video.video_id);
  favorites.unshift(video);
  favorites = favorites.slice(0, 30);

  setStorage(STORAGE_KEYS.favorites, favorites);

  renderFavorites();
  setStatus("Vídeo adicionado aos favoritos.", "success");
}

function addHistory(rawVideo) {
  const video = normalizeVideo(rawVideo);

  let history = getStorage(STORAGE_KEYS.history);

  history = history.filter(item => item.video_id !== video.video_id);

  history.unshift({
    ...video,
    played_at: new Date().toISOString()
  });

  history = history.slice(0, 15);

  setStorage(STORAGE_KEYS.history, history);

  renderHistory();
}

function renderMiniList(container, items, type) {
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `
      <div class="mini-empty">
        ${type === "favorites" ? "Sem favoritos." : "Sem histórico."}
      </div>
    `;
    return;
  }

  items.forEach(rawVideo => {
    const video = normalizeVideo(rawVideo);

    const item = document.createElement("div");
    item.className = "mini-item";

    item.innerHTML = `
      <img src="${escapeHtml(video.thumb)}" alt="">

      <div>
        <h4>${escapeHtml(video.title)}</h4>
        <p>${escapeHtml(video.channel)}</p>
      </div>

      <button title="Tocar">▶</button>
    `;

    item.querySelector("button").addEventListener("click", () => {
      playVideo(video, items, false);
    });

    container.appendChild(item);
  });
}

function renderFavorites() {
  const favorites = getStorage(STORAGE_KEYS.favorites);
  renderMiniList(favoritesBox, favorites, "favorites");
}

function renderHistory() {
  const history = getStorage(STORAGE_KEYS.history);
  renderMiniList(historyBox, history, "history");
}

async function testHealth() {
  setStatus("A testar ligação à aplicação...", "loading");

  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    if (!data.ok) {
      setStatus("A aplicação respondeu, mas existe algum problema.", "error");
      return;
    }

    if (!data.youtube_key_ready) {
      setStatus("A aplicação está online, mas falta configurar YOUTUBE_API_KEY.", "warning");
      return;
    }

    setStatus(
      `API pronta. Região: ${data.region}. Idioma: ${data.language}. Máximo: ${data.max_results} resultados.`,
      "success"
    );

  } catch (error) {
    setStatus(`Erro no teste: ${error.message}`, "error");
  }
}

function clearSearch() {
  searchInput.value = "";
  resultsBox.innerHTML = "";
  currentResults = [];
  activeQueue = [];
  currentIndex = -1;
  resultCount.textContent = "0 vídeos";

  setStatus("Pesquisa limpa. Escreve uma nova música ou artista.");
  searchInput.focus();
}

function clearFavorites() {
  localStorage.removeItem(STORAGE_KEYS.favorites);
  renderFavorites();
  setStatus("Favoritos apagados.", "success");
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEYS.history);
  renderHistory();
  setStatus("Histórico apagado.", "success");
}

searchBtn.addEventListener("click", searchVideos);

searchInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    searchVideos();
  }
});

clearBtn.addEventListener("click", clearSearch);
healthBtn.addEventListener("click", testHealth);
clearFavsBtn.addEventListener("click", clearFavorites);
clearHistoryBtn.addEventListener("click", clearHistory);

renderFavorites();
renderHistory();

setStatus("Pronto. Pesquisa uma música ou artista.");