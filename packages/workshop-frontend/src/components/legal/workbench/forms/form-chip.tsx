import type { GovernmentForm } from '@gadgets/workshop-shared/legal'

/** One vocabulary for a form's life: the chip names the NEXT truth (review → approve → client signs → in the packet). */
export const FORM_CHIP: Record<GovernmentForm['status'], { label: string; tone: 'ready' | 'warning' | 'neutral' | 'needsYou' }> = {
  signed: { label: 'Signed by the client', tone: 'ready' },
  awaiting_signature: { label: 'Awaiting client signature', tone: 'warning' },
  approved: { label: 'Approved — in the packet', tone: 'ready' },
  for_review: { label: 'For your review', tone: 'needsYou' },
  opened: { label: 'Opened — not filled yet', tone: 'neutral' },
  not_started: { label: 'Not started', tone: 'neutral' },
}
