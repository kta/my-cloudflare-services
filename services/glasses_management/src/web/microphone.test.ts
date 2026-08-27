import { describe, expect, it, vi } from 'vitest'
import { createMicrophoneRecorder } from './microphone'

type Listener = (event: { data: Blob }) => void

function fakeRecorder() {
  const listeners: Record<string, Listener[]> = {}
  const instance = {
    state: 'inactive',
    start: vi.fn(() => {
      instance.state = 'recording'
    }),
    stop: vi.fn(() => {
      instance.state = 'inactive'
      for (const listener of listeners.dataavailable ?? [])
        listener({ data: new Blob(['chunk'], { type: 'audio/webm' }) })
      for (const listener of listeners.stop ?? []) listener({ data: new Blob() })
    }),
    addEventListener: (name: string, listener: Listener) => {
      listeners[name] = [...(listeners[name] ?? []), listener]
    },
  }
  return instance
}

function environment(overrides: { getUserMedia?: () => Promise<MediaStream> } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const recorder = fakeRecorder()
  return {
    track,
    recorder,
    media: {
      getUserMedia: overrides.getUserMedia ?? vi.fn(async () => stream),
    },
    createRecorder: vi.fn(() => recorder as unknown as MediaRecorder),
  }
}

describe('microphone recorder', () => {
  it('reports granted and starts capturing only after permission is given', async () => {
    const env = environment()
    const microphone = createMicrophoneRecorder(env.media, env.createRecorder)

    expect(env.createRecorder).not.toHaveBeenCalled()
    await expect(microphone.requestPermission()).resolves.toBe('granted')
    expect(env.recorder.start).toHaveBeenCalledTimes(1)
  })

  it('reports denied and captures nothing when the browser refuses', async () => {
    // A refusal is not a recording failure: nothing was captured, so there is
    // no audio to upload and no retry to offer (UC-EYEX-177).
    const env = environment({
      getUserMedia: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }),
    })
    const microphone = createMicrophoneRecorder(env.media, env.createRecorder)

    await expect(microphone.requestPermission()).resolves.toBe('denied')
    await expect(microphone.capture()).resolves.toBeNull()
  })

  it('returns the captured audio once and releases the microphone', async () => {
    const env = environment()
    const microphone = createMicrophoneRecorder(env.media, env.createRecorder)
    await microphone.requestPermission()

    const audio = await microphone.capture()

    expect(audio?.type).toBe('audio/webm')
    expect(env.track.stop).toHaveBeenCalledTimes(1)
    // The device must not stay live after the reception ends.
    await expect(microphone.capture()).resolves.toBeNull()
  })

  it('captures nothing when permission was never requested', async () => {
    const env = environment()
    const microphone = createMicrophoneRecorder(env.media, env.createRecorder)

    await expect(microphone.capture()).resolves.toBeNull()
    expect(env.createRecorder).not.toHaveBeenCalled()
  })
})
