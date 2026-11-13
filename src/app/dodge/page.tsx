import { redirect } from 'next/navigation'

// Legacy route -> portal page (see src/app/play/page.tsx).
export default function Page() {
  redirect('/games/dodge')
}
