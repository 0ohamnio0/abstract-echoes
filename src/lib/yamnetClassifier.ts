import { AudioClassifier, FilesetResolver } from '@mediapipe/tasks-audio';
import type { SoundType } from './audioAnalyzer';

// YAMNet category names → our SoundType mapping
const CATEGORY_MAP: Record<string, SoundType> = {
  // Voice/Speech
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

  // Clap
  'Clapping': 'clap',
  'Hands': 'clap',
  'Slap, smack': 'clap',
  'Applause': 'clap',

  // Snap
  'Finger snapping': 'snap',
  'Click': 'snap',
  'Tick': 'snap',
  'Flick': 'snap',

  // Laugh
  'Laughter': 'laugh',
  'Baby laughter': 'laugh',
  'Chuckle, chortle': 'laugh',
  'Giggle': 'laugh',
  'Snicker': 'laugh',
};

// Categories we care about (for filtering)
const RELEVANT_CATEGORIES = new Set(Object.keys(CATEGORY_MAP));

export class YamnetClassifier {
  private classifier: AudioClassifier | null = null;
  private ready = false;
  private lastResult: SoundType = 'silence';
  private confidence = 0;
  private loading = false;

  async init(): Promise<void> {
    if (this.ready || this.loading) return;
    this.loading = true;
    try {
      const audio = await FilesetResolver.forAudioTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio/wasm'
      );
      this.classifier = await AudioClassifier.createFromOptions(audio, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite',
        },
        maxResults: 10,
        scoreThreshold: 0.05,
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

  /**
   * Classify a chunk of audio samples (Float32Array, mono, at given sampleRate).
   * Returns the mapped SoundType and confidence.
   */
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

      // Find the best matching category from our mapping
      for (const cat of categories) {
        const name = cat.categoryName || '';
        if (RELEVANT_CATEGORIES.has(name)) {
          const mapped = CATEGORY_MAP[name];
          this.lastResult = mapped;
          this.confidence = cat.score;
          return { type: mapped, confidence: cat.score, rawLabel: name };
        }
      }

      // If no relevant category found with good score, return silence
      this.lastResult = 'silence';
      this.confidence = 0;
      return { type: 'silence', confidence: 0, rawLabel: categories[0]?.categoryName || '' };
    } catch (e) {
      // Silently handle errors during classification
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
