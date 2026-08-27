import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { PublicBooking, type PublicBookingApi } from './PublicBooking'
import { PublicBookingRequestError } from './public-booking-client'

const store = {
  slug: 'ginza',
  name: '銀座店',
  contactPhone: '03-0000-0000',
  region: '東京都',
  nearestStation: '銀座駅',
}
const detail = {
  ...store,
  accessText: '銀座駅 A3出口から徒歩2分',
  notice: 'ご来店前に確認してください。',
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  purposes: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'メガネを新しく作りたい',
      durationMinutes: 60,
    },
  ],
}

test('starts the approved public flow by selecting a published store and its purpose', async () => {
  const cancelReservation = vi.fn(async () => ({ status: 'cancelled' as const, version: 2 }))
  const changeReservation = vi.fn(async () => ({
    status: 'confirmed' as const,
    version: 2,
    startAt: '2026-09-01T02:00:00.000Z',
    endAt: '2026-09-01T03:00:00.000Z',
    purposeIds: ['00000000-0000-4000-8000-000000000001'],
  }))
  const api: PublicBookingApi = {
    listStores: async () => [store],
    readStore: async () => detail,
    readSlots: async () => ({
      date: '2026-09-01',
      timezone: 'Asia/Tokyo',
      durationMinutes: 60,
      intervalMinutes: 30,
      slots: [
        {
          date: '2026-09-01',
          startTime: '10:00',
          endTime: '11:00',
          startAt: '2026-09-01T01:00:00.000Z',
          endAt: '2026-09-01T02:00:00.000Z',
        },
      ],
    }),
    createReservation: async () => ({
      reservationNumber: 'EY-0001',
      managementCode: 'ABCD-1234',
      emailStatus: 'sent',
    }),
    readReservationStatus: async () => ({ status: 'confirmed' }),
    verifyReservation: async () => ({
      reservationId: '00000000-0000-4000-8000-000000000001',
      verificationToken: 'a'.repeat(32),
      expiresAt: '2026-09-01T00:15:00.000Z',
      version: 1,
      startAt: '2026-09-01T01:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000001'],
      storeSlug: 'ginza',
    }),
    cancelReservation,
    changeReservation,
  }
  render(<PublicBooking api={api} />)

  expect(await screen.findByRole('button', { name: /銀座店.*店舗情報を見る/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /銀座店.*店舗情報を見る/ }))
  expect(await screen.findByRole('heading', { name: '銀座店' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '銀座店で予約を始める' }))

  expect(screen.getByRole('progressbar', { name: '予約工程 1 / 5' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  )
  expect(
    await screen.findByRole('heading', { name: '今回はどのようなご相談ですか？' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /メガネを新しく作りたい.*約60分/ }))
  expect(
    await screen.findByRole('heading', { name: 'ご希望の日時を選んでください' }),
  ).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('ご希望の日'), { target: { value: '2026-09-01' } })
  fireEvent.click(await screen.findByRole('button', { name: '9月1日 10:00' }))
  expect(
    await screen.findByRole('heading', { name: 'ご連絡先を入力してください' }),
  ).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '田中花子' } })
  fireEvent.change(screen.getByLabelText('お名前（かな）'), { target: { value: 'タナカハナコ' } })
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '09012345678' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), {
    target: { value: 'hanako@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: '確認へ進む' }))
  expect(
    await screen.findByRole('heading', { name: '予約内容をご確認ください' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'この内容で予約する' }))
  expect(await screen.findByRole('heading', { name: '予約を承りました' })).toBeInTheDocument()
  expect(await screen.findByText(/EY-0001/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '予約を変更・取り消す' }))
  expect(await screen.findByRole('heading', { name: '本人確認コードを入力' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('会社発行の管理コード'), {
    target: { value: 'ABCD-1234' },
  })
  fireEvent.click(screen.getByRole('button', { name: '予約を表示する' }))
  expect(await screen.findByRole('heading', { name: '予約内容を確認しました' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '予約日時を変更する' }))
  expect(await screen.findByRole('heading', { name: '変更後の日時を選ぶ' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('変更後の日'), { target: { value: '2026-09-01' } })
  fireEvent.click(await screen.findByRole('button', { name: '9月1日 10:00' }))
  expect(changeReservation).toHaveBeenCalledWith(
    '00000000-0000-4000-8000-000000000001',
    expect.objectContaining({ version: 1, date: '2026-09-01', startTime: '10:00' }),
    'a'.repeat(32),
    expect.any(String),
  )
  expect(await screen.findByText('予約を変更しました。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '予約を取り消す' }))
  expect(await screen.findByRole('heading', { name: '予約を取り消しました' })).toBeInTheDocument()
  expect(cancelReservation).toHaveBeenCalledWith(
    '00000000-0000-4000-8000-000000000001',
    { version: 2 },
    'a'.repeat(32),
    expect.any(String),
  )
})

test('checks the coarse result with the same confirmation key after the booking response is lost', async () => {
  const createReservation = vi.fn(async () => {
    throw new Error('network disconnected')
  })
  const readReservationStatus = vi.fn(async () => ({ status: 'confirmed' as const }))
  const api: PublicBookingApi = {
    listStores: async () => [store],
    readStore: async () => detail,
    readSlots: async () => ({
      date: '2026-09-01',
      timezone: 'Asia/Tokyo',
      durationMinutes: 60,
      intervalMinutes: 30,
      slots: [
        {
          date: '2026-09-01',
          startTime: '10:00',
          endTime: '11:00',
          startAt: '2026-09-01T01:00:00.000Z',
          endAt: '2026-09-01T02:00:00.000Z',
        },
      ],
    }),
    createReservation,
    readReservationStatus,
    verifyReservation: async () => ({
      reservationId: '00000000-0000-4000-8000-000000000001',
      verificationToken: 'a'.repeat(32),
      expiresAt: '2026-09-01T00:15:00.000Z',
      version: 1,
      startAt: '2026-09-01T01:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000001'],
      storeSlug: 'ginza',
    }),
    cancelReservation: async () => ({ status: 'cancelled', version: 2 }),
    changeReservation: async () => ({
      status: 'confirmed',
      version: 2,
      startAt: '2026-09-01T02:00:00.000Z',
      endAt: '2026-09-01T03:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000001'],
    }),
  }
  render(<PublicBooking api={api} createConfirmationKey={() => 'confirmation-key-1'} />)

  fireEvent.click(await screen.findByRole('button', { name: /銀座店.*店舗情報を見る/ }))
  fireEvent.click(await screen.findByRole('button', { name: '銀座店で予約を始める' }))
  fireEvent.click(await screen.findByRole('button', { name: /メガネを新しく作りたい.*約60分/ }))
  fireEvent.change(await screen.findByLabelText('ご希望の日'), { target: { value: '2026-09-01' } })
  fireEvent.click(await screen.findByRole('button', { name: '9月1日 10:00' }))
  fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '田中花子' } })
  fireEvent.change(screen.getByLabelText('お名前（かな）'), { target: { value: 'タナカハナコ' } })
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '09012345678' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), {
    target: { value: 'hanako@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: '確認へ進む' }))
  fireEvent.click(await screen.findByRole('button', { name: 'この内容で予約する' }))

  expect(
    await screen.findByRole('heading', { name: '予約結果を確認しています' }),
  ).toBeInTheDocument()
  expect(createReservation).toHaveBeenCalledWith('ginza', expect.anything(), 'confirmation-key-1')
  fireEvent.click(screen.getByRole('button', { name: '成立状況を再確認する' }))
  expect(
    await screen.findByRole('heading', { name: '予約の成立を確認しました' }),
  ).toBeInTheDocument()
  expect(readReservationStatus).toHaveBeenCalledWith('confirmation-key-1')
})

test('keeps customer input and returns to same-store alternatives when confirmation conflicts', async () => {
  const readSlots = vi.fn(async () => ({
    date: '2026-09-01',
    timezone: 'Asia/Tokyo' as const,
    durationMinutes: 60,
    intervalMinutes: 30,
    slots: [
      {
        date: '2026-09-01',
        startTime: '11:00',
        endTime: '12:00',
        startAt: '2026-09-01T02:00:00.000Z',
        endAt: '2026-09-01T03:00:00.000Z',
      },
    ],
  }))
  const api: PublicBookingApi = {
    listStores: async () => [store],
    readStore: async () => detail,
    readSlots,
    createReservation: async () => {
      throw new PublicBookingRequestError(409)
    },
    readReservationStatus: async () => ({ status: 'not_found' }),
    verifyReservation: async () => ({
      reservationId: '00000000-0000-4000-8000-000000000001',
      verificationToken: 'a'.repeat(32),
      expiresAt: '2026-09-01T00:15:00.000Z',
      version: 1,
      startAt: '2026-09-01T01:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000001'],
      storeSlug: 'ginza',
    }),
    cancelReservation: async () => ({ status: 'cancelled', version: 2 }),
    changeReservation: async () => ({
      status: 'confirmed',
      version: 2,
      startAt: '2026-09-01T02:00:00.000Z',
      endAt: '2026-09-01T03:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000001'],
    }),
  }
  render(<PublicBooking api={api} createConfirmationKey={() => 'confirmation-key-1'} />)

  fireEvent.click(await screen.findByRole('button', { name: /銀座店.*店舗情報を見る/ }))
  fireEvent.click(await screen.findByRole('button', { name: '銀座店で予約を始める' }))
  fireEvent.click(await screen.findByRole('button', { name: /メガネを新しく作りたい.*約60分/ }))
  fireEvent.change(await screen.findByLabelText('ご希望の日'), { target: { value: '2026-09-01' } })
  fireEvent.click(await screen.findByRole('button', { name: '9月1日 11:00' }))
  fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '田中花子' } })
  fireEvent.change(screen.getByLabelText('お名前（かな）'), { target: { value: 'タナカハナコ' } })
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '09012345678' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), {
    target: { value: 'hanako@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: '確認へ進む' }))
  fireEvent.click(await screen.findByRole('button', { name: 'この内容で予約する' }))

  expect(
    await screen.findByRole('heading', { name: 'ご希望の日時を選んでください' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    '選択した時間は他のお客様の予約で埋まりました',
  )
  fireEvent.click(screen.getByRole('button', { name: '9月1日 11:00' }))
  expect(await screen.findByLabelText('お名前')).toHaveValue('田中花子')
  expect(readSlots).toHaveBeenCalledTimes(2)
})
