import './app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isPublicBookingPath, publicBookingSlug, sharedTerminalEntry } from './app-route'
import { Gallery } from './gallery/Gallery'
import { PublicBooking } from './PublicBooking'
import { createPublicBookingApi } from './public-booking-client'
import { StaffWorkspace } from './StaffWorkspace'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    {/*
      デザインの突き合わせ台。API を通さず、承認済みモックと同じ状態を固定値で
      描く。業務の入口ではないので、他のどの経路より先に判定する。
    */}
    {window.location.pathname === '/__gallery' ? (
      <Gallery screen={new URLSearchParams(window.location.search).get('screen')} />
    ) : isPublicBookingPath(window.location.pathname) ? (
      <PublicBooking
        api={createPublicBookingApi()}
        initialStoreSlug={publicBookingSlug(window.location.pathname)}
      />
    ) : (
      <StaffWorkspace
        terminalId={sharedTerminalEntry(window.location.pathname)?.terminalId ?? null}
        terminalToken={sharedTerminalEntry(window.location.pathname)?.token}
      />
    )}
  </StrictMode>,
)
