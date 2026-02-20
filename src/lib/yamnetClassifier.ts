import type { SoundType } from './audioAnalyzer';

// YAMNet category names → our SoundType mapping
const CATEGORY_MAP: Record<string, SoundType> = {
  'Speech': 'voice',
  'Narration, monologue': 'voice',
  'Conversation': 'voice',
  'Speech synthesizer': 'voice',
  'Singing': 'voice',
  'Child speech, kid speaking': 'voice',
  'Female speech, woman speaking': 'voice',
  'Male speech, man speaking': 'voice',
  'Whispering': 'voice',
  'Shout': 'voice',
  'Clapping': 'clap',
  'Hands': 'clap',
  'Slap, smack': 'clap',
  'Applause': 'clap',
  'Finger snapping': 'snap',
  'Click': 'snap',
  'Tick': 'snap',
  'Flick': 'snap',
  'Laughter': 'laugh',
  'Baby laughter': 'laugh',
  'Chuckle, chortle': 'laugh',
  'Giggle': 'laugh',
  'Snicker': 'laugh',
};

const RELEVANT_CATEGORIES = new Set(Object.keys(CATEGORY_MAP));

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';

export class YamnetClassifier {
  private classifier: any = null;
  private ready = false;
  private lastResult: SoundType = 'silence';
  private confidence = 0;
  private loading = false;
  scoreThreshold = 0.05;
  maxResults = 10;

  async init(): Promise<void> {
    if (this.ready || this.loading) return;
    this.loading = true;
    try {
      // Dynamically import to avoid bundler issues
      const tasksAudio = await import('@mediapipe/tasks-audio');
      
      // Try FilesetResolver first, fall back to manual WasmFileset
      let wasmFileset: any;
      if (tasksAudio.FilesetResolver) {
        wasmFileset = await tasksAudio.FilesetResolver.forAudioTasks(CDN_BASE);
      } else {
        // Manually construct WasmFileset
        wasmFileset = {
          wasmLoaderPath: `${CDN_BASE}/audio_wasm_internal.js`,
          wasmBinaryPath: `${CDN_BASE}/audio_wasm_internal.wasm`,
        };
      }

      this.classifier = await tasksAudio.AudioClassifier.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
        },
        maxResults: this.maxResults,
        scoreThreshold: this.scoreThreshold,
      });
      this.ready = true;
      console.log('[YAMNet] Model loaded successfully');
    } catch (e) {
      console.error('[YAMNet] Failed to load model:', e);
    } finally {
      this.loading = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  classify(samples: Float32Array, sampleRate: number): { type: SoundType; confidence: number; rawLabel: string } {
    if (!this.classifier || !this.ready) {
      return { type: 'silence', confidence: 0, rawLabel: '' };
    }

    try {
      const results = this.classifier.classify(samples, sampleRate);
      if (!results || results.length === 0) {
        return { type: 'silence', confidence: 0, rawLabel: '' };
      }

      const categories = results[0]?.classifications?.[0]?.categories;
      if (!categories || categories.length === 0) {
        return { type: 'silence', confidence: 0, rawLabel: '' };
      }

      for (const cat of categories) {
        const name = cat.categoryName || '';
        if (RELEVANT_CATEGORIES.has(name)) {
          const mapped = CATEGORY_MAP[name];
          this.lastResult = mapped;
          this.confidence = cat.score;
          return { type: mapped, confidence: cat.score, rawLabel: name };
        }
      }

      this.lastResult = 'silence';
      this.confidence = 0;
      return { type: 'silence', confidence: 0, rawLabel: categories[0]?.categoryName || '' };
    } catch (e) {
      return { type: this.lastResult, confidence: this.confidence, rawLabel: '' };
    }
  }

  getLastResult(): SoundType {
    return this.lastResult;
  }

  destroy(): void {
    this.classifier?.close();
    this.classifier = null;
    this.ready = false;
  }
}
