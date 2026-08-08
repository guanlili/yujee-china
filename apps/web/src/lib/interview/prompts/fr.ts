// TODO(i18n-translate): placeholder copy of en, to be replaced
import type { InterviewCase } from '../interview';

export const fr: Record<InterviewCase, readonly [string, string, string]> = {
  timeAndPlace: [
    "I've grouped these photos for you.",
    'I’d love to know a little more — who were you with that day?',
    'Any special people, moments, or feelings you’d like woven into this book?',
  ],
  timeOnly: [
    'These photos have a lovely feel to them.',
    'Where were they taken, and who were you with?',
    'Tell me any memory or mood you’d like to keep.',
  ],
  placeOnly: [
    "I've looked through these photos.",
    'Roughly when were they taken, and who were you with?',
    'Any story or feeling you especially want to record?',
  ],
  neither: [
    'I’d love to understand these photos a little more.',
    'Roughly when, where, and with whom were they taken?',
    'What happened, how did it feel — tell me anything you like.',
  ],
};
