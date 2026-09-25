import { defineStore } from 'pinia';
import api from '../api/client';
import { useViewSession } from '../composables/useViewSession';
import { coverUrl as buildCoverUrl } from '../utils/cover';

let audio = null;
let saveInterval = null;
let sleepTimeout = null;
const viewSession = useViewSession();

export const usePlayerStore = defineStore('player', {
  state: () => ({
    currentItem: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    volume: 1.0,
    sleepTimerMinutes: null,
    isExpanded: false
  }),

  actions: {
    initAudio() {
      if (audio) return audio;
      audio = new Audio();

      audio.addEventListener('timeupdate', () => {
        this.currentTime = audio.currentTime;
      });

      audio.addEventListener('durationchange', () => {
        this.duration = audio.duration || 0;
      });

      audio.addEventListener('ended', () => {
        this.isPlaying = false;
        this.saveProgress(true);
        viewSession.close();
      });

      audio.addEventListener('play', () => {
        this.isPlaying = true;
        this.startProgressAutoSave();
        this.updateMediaSession();
      });

      audio.addEventListener('pause', () => {
        this.isPlaying = false;
        this.stopProgressAutoSave();
        this.saveProgress();
      });

      this.setupMediaSessionHandlers();
      return audio;
    },

    playItem(item, startTime = null) {
      this.initAudio();
      const isNewItem = this.currentItem?.id !== item.id;
      this.currentItem = item;

      const token = localStorage.getItem('plinthio_token');
      const streamUrl = `/api/media/stream/${item.id}?token=${token}`;

      const resumeTime = startTime !== null ? startTime : (item.current_time || 0);

      // Only re-set src if playing a different item or not set
      if (audio.src !== window.location.origin + streamUrl) {
        if (isNewItem) {
          // Fire-and-forget: closes the previous item's listening session (if any) and
          // opens one for this item. Never awaited — tracking must not delay playback.
          viewSession.open(item.id);
        }
        audio.src = streamUrl;
        audio.playbackRate = this.playbackRate;

        const onLoadedMetadata = () => {
          if (resumeTime > 0) {
            audio.currentTime = resumeTime;
            this.currentTime = resumeTime;
          }
          audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        };
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
      } else if (resumeTime > 0) {
        audio.currentTime = resumeTime;
        this.currentTime = resumeTime;
      }

      audio.play().catch(err => {
        console.warn('Auto-playback blocked or error:', err);
      });
      this.updateMediaSession();
    },

    togglePlay() {
      if (!audio || !this.currentItem) return;
      if (this.isPlaying) {
        audio.pause();
      } else {
        audio.play().catch(console.warn);
      }
    },

    seek(seconds) {
      if (!audio) return;
      audio.currentTime = Math.max(0, Math.min(seconds, this.duration));
      this.currentTime = audio.currentTime;
      this.saveProgress();
    },

    skip(seconds) {
      if (!audio) return;
      this.seek(audio.currentTime + seconds);
    },

    setPlaybackRate(rate) {
      this.playbackRate = rate;
      if (audio) audio.playbackRate = rate;
    },

    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, val));
      if (audio) audio.volume = this.volume;
    },

    setSleepTimer(minutes) {
      if (sleepTimeout) {
        clearTimeout(sleepTimeout);
        sleepTimeout = null;
      }
      this.sleepTimerMinutes = minutes;
      if (minutes) {
        sleepTimeout = setTimeout(() => {
          if (audio) audio.pause();
          this.sleepTimerMinutes = null;
        }, minutes * 60 * 1000);
      }
    },

    async saveProgress(isFinished = false) {
      if (!this.currentItem) return;
      try {
        await api.post(`/progress/${this.currentItem.id}`, {
          currentTime: this.currentTime,
          duration: this.duration || this.currentItem.duration,
          isFinished: isFinished ? 1 : 0
        });
      } catch (err) {
        console.warn('Failed to save playback progress:', err.message);
      }
    },

    startProgressAutoSave() {
      if (saveInterval) clearInterval(saveInterval);
      saveInterval = setInterval(() => {
        this.saveProgress();
      }, 5000); // Save every 5 seconds
    },

    stopProgressAutoSave() {
      if (saveInterval) {
        clearInterval(saveInterval);
        saveInterval = null;
      }
    },

    updateMediaSession() {
      if (!('mediaSession' in navigator) || !this.currentItem) return;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentItem.title || 'Plinthio Audiobook',
        artist: this.currentItem.author || 'Unknown Author',
        album: this.currentItem.series || 'Plinthio',
        artwork: [
          { src: buildCoverUrl(this.currentItem, { width: 360, raw: true }), sizes: '512x512', type: 'image/jpeg' }
        ]
      });
    },

    setupMediaSessionHandlers() {
      if (!('mediaSession' in navigator)) return;

      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        this.skip(-(details.seekOffset || 15));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        this.skip(details.seekOffset || 15);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) this.seek(details.seekTime);
      });
    }
  }
});
