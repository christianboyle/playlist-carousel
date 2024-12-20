const config = {
  clientId: window.APP_CONFIG.clientId,
  clientSecret: window.APP_CONFIG.clientSecret
};

(function(global) {
  'use strict';

  var $view = document.getElementById('playlist');
  var player = new SoundCloudAudio();
  var currentToken = null;

  function getStoredToken() {
    const tokenData = localStorage.getItem('sc_token_data');
    if (!tokenData) return null;
    
    try {
      const { token, expiresAt } = JSON.parse(tokenData);
      if (Date.now() >= (expiresAt - 300000)) return null;
      return token;
    } catch (e) {
      return null;
    }
  }

  function storeToken(token, expiresIn) {
    const expiresAt = Date.now() + (expiresIn * 1000);
    localStorage.setItem('sc_token_data', JSON.stringify({
      token,
      expiresAt
    }));
  }

  async function refreshToken(retryCount = 0) {
    const storedToken = getStoredToken();
    if (storedToken) {
      return storedToken;
    }

    const maxRetries = 3;
    const delay = retryCount ? Math.pow(2, retryCount) * 1000 : 0;

    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch('https://api.soundcloud.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=client_credentials&client_id=${config.clientId}&client_secret=${config.clientSecret}`
      });

      const data = await response.json();

      if (response.status === 429) {
        if (retryCount < maxRetries) {
          return refreshToken(retryCount + 1);
        } else {
          throw new Error('Max retry attempts reached');
        }
      }

      if (data.access_token) {
        storeToken(data.access_token, data.expires_in || 3600);
        return data.access_token;
      } else {
        throw new Error('Invalid token response');
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }
  
  player._json = function(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.setRequestHeader('Authorization', 'OAuth ' + currentToken);
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 401) {
          refreshToken().then(newToken => {
            currentToken = newToken;
            player._json(url, callback);
          });
        } else if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            callback(data);
          } catch (err) {
          }
        }
      }
    };

    xhr.send(null);
  };

  function formatDuration(ms) {
    var minutes = Math.floor(ms / 60000);
    var seconds = ((ms % 60000) / 1000).toFixed(0);
    return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
  }

  async function loadPlaylists() {
    try {
      const playlistsContainer = document.createElement('div');
      playlistsContainer.className = 'playlists-container';
      $view.innerHTML = '';
      $view.appendChild(playlistsContainer);
      
      setupGridView(playlistsContainer);
      setupScrollHandler(playlistsContainer);
      setupTextVisibility(playlistsContainer);
      
      const response = await fetch('./playlists.json');
      const data = await response.json();
      
      const CHUNK_SIZE = 5;
      const chunks = [];
      
      for (let i = 0; i < data.playlists.length; i += CHUNK_SIZE) {
        chunks.push(data.playlists.slice(i, i + CHUNK_SIZE));
      }
      
      const playlistDivs = data.playlists.map((_, index) => {
        const div = document.createElement('div');
        div.className = 'playlist';
        div.innerHTML = `
          <div class="playlist-card">
            <div class="skeleton-loader"></div>
          </div>
        `;
        playlistsContainer.appendChild(div);
        return div;
      });
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        await Promise.all(chunk.map((playlistUrl, chunkIndex) => {
          const globalIndex = i * CHUNK_SIZE + chunkIndex;
          return new Promise((resolve) => {
            try {
              player.resolve(playlistUrl, function(playlist) {
                const playlistDiv = playlistDivs[globalIndex];
                if (!playlistDiv || !playlistDiv.isConnected) {
                  resolve();
                  return;
                }
                
                const imageUrl = playlist.artwork_url ? 
                  playlist.artwork_url.replace('large', 't500x500') : 
                  'https://placeholder.com/500x500';
                
                playlistDiv.innerHTML = `
                  <div class="playlist-card">
                    <a href="${playlist.permalink_url}" class="playlist-link" target="_blank">
                      <div class="playlist-artwork">
                        <img src="${imageUrl}" alt="${playlist.title}">
                      </div>
                      <div class="playlist-details">
                        <h1 class="playlist-title">${playlist.title}</h1>
                        <div class="playlist-info">by ${playlist.user.username}</div>
                        <div class="playlist-info">${playlist.track_count} tracks · ${formatDuration(playlist.duration)}</div>
                      </div>
                    </a>
                  </div>
                `;
                resolve();
              });
            } catch (e) {
              resolve();
            }
          });
        }));
        
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
    } catch (e) {
      $view.innerHTML = 'Error loading playlists';
    }
  }

  function setupScrollHandler(container) {
    // For list view
    container.addEventListener('wheel', (e) => {
      const isGridView = container.classList.contains('grid-view');
      if (!isGridView) {
        e.preventDefault();
        const scrollAmount = e.deltaY * 14;
        const currentScroll = container.scrollLeft;
        const maxScroll = container.scrollWidth - container.clientWidth;
        const newScrollPosition = Math.max(0, Math.min(currentScroll + scrollAmount, maxScroll));
        
        container.scrollTo({
          left: newScrollPosition,
          behavior: 'smooth'
        });
      }
    }, { passive: false });

    // For grid view
    document.body.addEventListener('wheel', (e) => {
      const isGridView = container.classList.contains('grid-view');
      if (isGridView) {
        const scrollAmount = e.deltaY * 3;  // Reduced multiplier for smoother vertical scroll
        const currentScroll = window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const newScrollPosition = Math.max(0, Math.min(currentScroll + scrollAmount, maxScroll));
        
        window.scrollTo({
          top: newScrollPosition,
          behavior: 'smooth'
        });
      }
    });
  }

  function setupDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    const savedPreference = localStorage.getItem('darkMode');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedPreference === null && systemPrefersDark) {
      document.body.classList.add('dark-mode');
      darkModeToggle.innerHTML = '☀️';
    } else if (savedPreference === 'true') {
      document.body.classList.add('dark-mode');
      darkModeToggle.innerHTML = '☀️';
    } else {
      darkModeToggle.innerHTML = '🌙';
    }
    
    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDarkMode = document.body.classList.contains('dark-mode');
      darkModeToggle.innerHTML = isDarkMode ? '☀️' : '🌙';
      
      localStorage.setItem('darkMode', isDarkMode);
    });
  }

  function setupGridView(playlistsContainer) {
    const viewToggle = document.getElementById('viewToggle');
    
    viewToggle.addEventListener('click', () => {
      const isGridView = !playlistsContainer.classList.contains('grid-view');
      
      // Reset all scroll positions before toggling the class
      if (isGridView) {
        // Reset all possible scroll positions
        window.scrollTo(0, 0);
        document.documentElement.scrollTo(0, 0);
        document.body.scrollTo(0, 0);
        playlistsContainer.scrollTo(0, 0);
      }
      
      // Toggle the class after resetting scroll
      playlistsContainer.classList.toggle('grid-view');
      viewToggle.innerHTML = isGridView ? '📜' : '📱';
      
      localStorage.setItem('gridView', isGridView);
    });
    
    // Handle initial load
    if (localStorage.getItem('gridView') === 'true') {
      // Reset all scroll positions first
      window.scrollTo(0, 0);
      document.documentElement.scrollTo(0, 0);
      document.body.scrollTo(0, 0);
      playlistsContainer.scrollTo(0, 0);
      
      // Then add the grid view class
      playlistsContainer.classList.add('grid-view');
      viewToggle.innerHTML = '📜';
    } else {
      viewToggle.innerHTML = '📱';
    }
  }

  function setupTextVisibility(playlistsContainer) {
    const textContainer = document.querySelector('.text-container');
    
    function updateTextVisibility() {
      const firstPlaylist = playlistsContainer.querySelector('.playlist');
      if (!firstPlaylist || !textContainer) return;
      
      const textRect = textContainer.getBoundingClientRect();
      const playlistRect = firstPlaylist.getBoundingClientRect();
      const isGridView = playlistsContainer.classList.contains('grid-view');
      
      if (isGridView) {
        // Hide text when first playlist moves above text container's bottom edge
        const isHidden = playlistRect.top < textRect.bottom;
        textContainer.style.opacity = isHidden ? '0' : '1';
      } else {
        const isHidden = textRect.right > playlistRect.left;
        textContainer.style.opacity = isHidden ? '0' : '1';
      }
    }
    
    // For list view horizontal scrolling
    playlistsContainer.addEventListener('scroll', () => {
      requestAnimationFrame(updateTextVisibility);
    });
    
    // For grid view vertical scrolling
    document.body.addEventListener('scroll', () => {
      requestAnimationFrame(updateTextVisibility);
    });
    
    // Update on view mode change
    document.getElementById('viewToggle').addEventListener('click', () => {
      setTimeout(updateTextVisibility, 100);
    });
    
    // Initial check
    setTimeout(updateTextVisibility, 100);
  }

  // Initialize everything
  refreshToken().then(token => {
    currentToken = token;
    loadPlaylists();
  }).catch(() => {
    $view.innerHTML = 'Error loading playlists';
  });

  setupDarkMode();

})(this); 