import { redirect } from 'next/navigation'

// Legacy route -> portal page. next.config redirects handle the dynamic
// server (preserving query strings like ?wave=5); this stub keeps the
// static export working (it prerenders as a meta-refresh page).
export default function PlayPage() {
  redirect('/games/arena')
}
