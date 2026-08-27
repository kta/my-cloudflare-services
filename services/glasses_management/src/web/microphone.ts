import type { MicrophonePermissionResult } from './RecordingIndicator'

type MediaAccess = Pick<MediaDevices, 'getUserMedia'>
type RecorderFactory = (stream: MediaStream) => MediaRecorder

/**
 * The single place the browser microphone is touched.
 *
 * Everything above it deals in decisions and blobs, so the booking flow and its
 * tests take the same path. A refusal is deliberately not a recording failure:
 * nothing was captured, so there is nothing to upload and nothing to retry
 * (UC-EYEX-177). The stream is released as soon as the capture ends — a shared
 * iPad must never be left listening after a reception (UC-EYEX-031, 035).
 */
export function createMicrophoneRecorder(
  media: MediaAccess,
  createRecorder: RecorderFactory = (stream) =>
    new MediaRecorder(stream, { mimeType: 'audio/webm' }),
) {
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  let chunks: Blob[] = []

  const release = () => {
    stream?.getTracks().forEach((track) => {
      track.stop()
    })
    stream = undefined
    recorder = undefined
  }

  return {
    async requestPermission(): Promise<MicrophonePermissionResult> {
      try {
        stream = await media.getUserMedia({ audio: true })
      } catch {
        return 'denied'
      }
      chunks = []
      recorder = createRecorder(stream)
      recorder.addEventListener('dataavailable', (event) => {
        const blob = (event as unknown as { data: Blob }).data
        if (blob.size > 0) chunks.push(blob)
      })
      recorder.start()
      return 'granted'
    },
    async capture(): Promise<Blob | null> {
      const active = recorder
      if (!active) return null
      const stopped = new Promise<void>((resolve) => {
        active.addEventListener('stop', () => {
          resolve()
        })
      })
      active.stop()
      await stopped
      release()
      const captured = chunks
      chunks = []
      return captured.length === 0 ? null : new Blob(captured, { type: 'audio/webm' })
    },
  }
}
