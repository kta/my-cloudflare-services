import './app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isPublicBookingPath, publicBookingSlug } from './app-route'
import { PublicBooking } from './PublicBooking'
import { createPublicBookingApi } from './public-booking-client'
import { StaffWorkspace } from './StaffWorkspace'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    {isPublicBookingPath(window.location.pathname) ? (
      <PublicBooking
        api={createPublicBookingApi()}
        initialStoreSlug={publicBookingSlug(window.location.pathname)}
      />
    ) : (
      <StaffWorkspace />
    )}
  </StrictMode>,
)
