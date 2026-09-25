import { getMediaToken } from '../utils/mediaToken';
import { defineStore } from 'pinia';
import api from '../api/client';
import { useViewSession } from '../composables/useViewSession';
import { coverUrl as buildCoverUrl } from '../utils/cover';

let audio = null;
let saveInterval = null;
let sleepTicker = null;
// Last stretch of a timed sleep fades the volume down instead of cutting off mid-sentence.
const SLEEP_FADE_SECONDS = 10;
export const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
const viewSession = useViewSession();

export const usePlayerStore = defineStore('player', {
  state: () => ({
    currentItem: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    volume: 1.0,
    // Sleep timer: a number of minutes, 'chapter' (stop at the end of the current chapter),
    // or null. sleepEndsAt/sleepRemaining drive the live countdown in the UI.
    sleepTimerMinutes: null,
    sleepEndsAt: null,
    sleepRemaining: 0,
    sleepChapterEnd: null,
    chapters: [],
    isExpanded: false
  }),

  getters: {
    currentChapterIndex(state) {
      const t = state.currentTime;
      for (let i = state.chapters.length - 1; i >= 0; i--) {
        if (t >= state.chapters[i].start - 0.5) return i;
      }
      return state.chapters.length ? 0 : -1;
    },
    currentChapter() {
      return this.currentChapterIndex >= 0 ? this.chapters[this.currentChapterIndex] : null;
    }
  },

  actions: {
    initAudio() {
      if (audio) return audio;
      audio = new Audio();

      audio.addEventListener('timeupdate', () => {
        this.currentTime = audio.currentTime;
        if (this.sleepChapterEnd !== null && audio.currentTime >= this.sleepChapterEnd - 0.25) {
          audio.pause();
          this.clearSleepTimer();
        }
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

      const token = getMediaToken();
      const streamUrl = `/api/media/stream/${item.id}?token=${token}`;

      const resumeTime = startTime !== null ? startTime : (item.current_time || 0);

      // Only re-set src if playing a different item or not set
      if (audio.src !== window.location.origin + streamUrl) {
        if (isNewItem) {
          // Fire-and-forget: closes the previous item's listening session (if any) and
          // opens one for this item. Never awaited — tracking must not delay playback.
          viewSession.open(item.id);
          this.chapters = [];
          this.clearSleepTimer();
          this.loadChapters(item.id);
          this.restoreBookSpeed(item.id);
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
      // Remembered per book (saved alongside progress, so it syncs across devices).
      this.saveProgress();
    },

    // Picks up the speed this listener last used for this book, if any. Otherwise the
    // current speed carries over, which is what someone who listens at 1.5x expects.
    async restoreBookSpeed(itemId) {
      try {
        const res = await api.get(`/progress/${itemId}`);
        const rate = res.data.progress?.playback_rate;
        if (rate && this.currentItem?.id === itemId) {
          this.playbackRate = rate;
          if (audio) audio.playbackRate = rate;
        }
      } catch (err) {
        // No stored speed — keep the current one.
      }
    },

    async loadChapters(itemId) {
      try {
        const res = await api.get(`/items/${itemId}/chapters`);
        if (this.currentItem?.id === itemId) this.chapters = res.data.chapters || [];
      } catch (err) {
        if (this.currentItem?.id === itemId) this.chapters = [];
      }
    },

    seekChapter(index) {
      const chapter = this.chapters[index];
      if (chapter) this.seek(chapter.start);
    },

    // "Previous" restarts the current chapter unless you're within its first few seconds,
    // like every audio app's back button.
    previousChapter() {
      const idx = this.currentChapterIndex;
      if (idx < 0) return this.skip(-30);
      const chapter = this.chapters[idx];
      if (this.currentTime - chapter.start > 3 || idx === 0) return this.seek(chapter.start);
      this.seekChapter(idx - 1);
    },

    nextChapter() {
      const idx = this.currentChapterIndex;
      if (idx < 0) return this.skip(30);
      if (idx < this.chapters.length - 1) this.seekChapter(idx + 1);
    },

    // Stops playback and dismisses the player entirely.
    stop() {
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      this.clearSleepTimer();
      this.stopProgressAutoSave();
      viewSession.close();
      this.isPlaying = false;
      this.currentItem = null;
      this.chapters = [];
    },

    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, val));
      if (audio) audio.volume = this.volume;
    },

    clearSleepTimer() {
      if (sleepTicker) {
        clearInterval(sleepTicker);
        sleepTicker = null;
      }
      if (audio) audio.volume = this.volume;
      this.sleepTimerMinutes = null;
      this.sleepEndsAt = null;
      this.sleepRemaining = 0;
      this.sleepChapterEnd = null;
    },

    // `minutes` is a number, 'chapter', or null to cancel.
    setSleepTimer(minutes) {
      this.clearSleepTimer();
      if (!minutes) return;

      if (minutes === 'chapter') {
        const chapter = this.currentChapter;
        if (!chapter) return;
        this.sleepTimerMinutes = 'chapter';
        this.sleepChapterEnd = chapter.end;
        return;
      }

      this.sleepTimerMinutes = minutes;
      this.sleepEndsAt = Date.now() + minutes * 60 * 1000;
      const tick = () => {
        const remaining = Math.max(0, (this.sleepEndsAt - Date.now()) / 1000);
        this.sleepRemaining = Math.ceil(remaining);
        if (audio && remaining <= SLEEP_FADE_SECONDS) {
          audio.volume = this.volume * (remaining / SLEEP_FADE_SECONDS);
        }
        if (remaining <= 0) {
          if (audio) audio.pause();
          this.clearSleepTimer();
        }
      };
      tick();
      sleepTicker = setInterval(tick, 1000);
    },

    async saveProgress(isFinished = false) {
      if (!this.currentItem) return;
      try {
        await api.post(`/progress/${this.currentItem.id}`, {
          currentTime: this.currentTime,
          duration: this.duration || this.currentItem.duration,
          playbackRate: this.playbackRate,
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
      // Lock-screen / headphone track buttons move between chapters.
      try {
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previousChapter());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.nextChapter());
      } catch (e) {
        // Older browsers reject unknown actions.
      }
    }
  }
});
