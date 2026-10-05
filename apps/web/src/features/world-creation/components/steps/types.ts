export interface StepProps {
  /** Short, positive confirmation shown near the preview (and announced politely). */
  onFeedback: (message: string) => void;
}
