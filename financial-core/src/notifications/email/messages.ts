/**
 * Email copy, in every language the app ships.
 *
 * The money emails were English-only with a hardcoded `₮`, while every one of
 * the frontend's eight locales writes `$` — so one deposit told the player
 * `₮30.00` by email and `$30.00` in the app, in two different languages. The
 * in-app notification was always translated (it stores a titleKey and renders
 * at read time); only email was not.
 *
 * THE CURRENCY MARK LIVES IN THE STRING, NOT IN THE FORMATTER. Every locale
 * places it differently, so each phrase below carries its own `$` exactly where
 * that language wants it, and `formatAmount` returns digits only. Adding a
 * symbol there as well is how `$$30.00` ships — see docs/TRAPS.md #4, which has
 * caught this three times on the frontend.
 *
 * Wording is lifted from the frontend's existing locale files wherever a phrase
 * already existed (`notifications.*`, `wallet.txnDetail.*`) rather than
 * re-translated, so a receipt reads like the screen it is reporting on.
 */

export const LOCALES = ['en', 'zh', 'ja', 'ko', 'th', 'vi', 'hi', 'id'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

interface Event {
  heading: string;
  /** The big line under the heading. Carries `$`. */
  amountLine: string;
  note: string;
  /** Carries `$`. */
  subject: string;
}

export interface EmailMessages {
  deposit: Event;
  withdrawalRequested: Event;
  withdrawalSent: Event;
  labels: {
    amount: string;
    network: string;
    transaction: string;
    dateTime: string;
    toAddress: string;
    requested: string;
    sent: string;
    status: string;
  };
  status: { credited: string; requested: string; sent: string };
  footer: { questions: string; contactSupport: string; why: string };
}

/**
 * A BCP-47 tag from Settings to a locale we actually have copy for.
 *
 * Primary subtag only: `zh-CN` and `zh-TW` both land on `zh`, which is the one
 * Chinese the app ships. Anything unknown, empty or null falls back to English
 * rather than throwing — a player whose language we cannot place still gets
 * their receipt.
 */
export function resolveLocale(language: string | null | undefined): Locale {
  if (!language) return DEFAULT_LOCALE;
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(primary ?? '')
    ? (primary as Locale)
    : DEFAULT_LOCALE;
}

/** Fill `{{amount}}`. Deliberately tiny — this is not a template engine. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

export const MESSAGES: Record<Locale, EmailMessages> = {
  en: {
    deposit: {
      heading: 'Deposit received',
      amountLine: '${{amount}} received',
      note: 'Credited to your wallet and available now.',
      subject: 'Deposit of ${{amount}} credited',
    },
    withdrawalRequested: {
      heading: 'Withdrawal requested',
      amountLine: 'Withdrawal of ${{amount}}',
      // Deliberately plain. "Pending review" invites the reading that something
      // is wrong; this states what happens next and nothing more.
      note: 'We have your request. You will get another email when it is sent.',
      subject: 'Withdrawal of ${{amount}} requested',
    },
    withdrawalSent: {
      heading: 'Withdrawal sent',
      amountLine: '${{amount}} sent',
      note: 'Broadcast to the network. Arrival depends on confirmations.',
      subject: 'Withdrawal of ${{amount}} sent',
    },
    labels: {
      amount: 'Amount',
      network: 'Network',
      transaction: 'Transaction hash',
      dateTime: 'Date & time',
      toAddress: 'Destination TRON address',
      requested: 'Requested',
      sent: 'Sent',
      status: 'Status',
    },
    status: { credited: 'Completed', requested: 'Requested', sent: 'Sent' },
    footer: {
      questions: 'Questions?',
      contactSupport: 'Contact support',
      why: 'You are receiving this because this address is on a MYPOKER account with wallet activity.',
    },
  },

  zh: {
    deposit: {
      heading: '充值已到账',
      amountLine: '已收到 ${{amount}}',
      note: '已存入您的钱包，现在即可使用。',
      subject: '充值 ${{amount}} 已到账',
    },
    withdrawalRequested: {
      heading: '提现申请已提交',
      amountLine: '提现 ${{amount}}',
      note: '我们已收到您的申请。发出后会再发送一封邮件通知您。',
      subject: '已提交 ${{amount}} 提现申请',
    },
    withdrawalSent: {
      heading: '提现已发出',
      amountLine: '已发出 ${{amount}}',
      note: '已广播至网络。到账时间取决于确认数。',
      subject: '提现 ${{amount}} 已发出',
    },
    labels: {
      amount: '金额',
      network: '网络',
      transaction: '交易哈希',
      dateTime: '日期和时间',
      toAddress: '目标 TRON 地址',
      requested: '申请时间',
      sent: '发送时间',
      status: '状态',
    },
    status: { credited: '已完成', requested: '已申请', sent: '已发出' },
    footer: {
      questions: '有疑问？',
      contactSupport: '联系客服',
      why: '您收到此邮件，是因为该邮箱绑定了有钱包活动的 MYPOKER 账户。',
    },
  },

  ja: {
    deposit: {
      heading: '入金が反映されました',
      amountLine: '${{amount}} を受け取りました',
      note: 'ウォレットに反映され、すぐにご利用いただけます。',
      subject: '${{amount}} の入金が反映されました',
    },
    withdrawalRequested: {
      heading: '出金を受け付けました',
      amountLine: '${{amount}} の出金',
      note: 'リクエストを受け付けました。送信時に改めてメールでお知らせします。',
      subject: '${{amount}} の出金を受け付けました',
    },
    withdrawalSent: {
      heading: '出金を送信しました',
      amountLine: '${{amount}} を送信しました',
      note: 'ネットワークに送信しました。着金は承認数によります。',
      subject: '${{amount}} の出金を送信しました',
    },
    labels: {
      amount: '金額',
      network: 'ネットワーク',
      transaction: 'トランザクションハッシュ',
      dateTime: '日時',
      toAddress: '送金先 TRON アドレス',
      requested: '申請日時',
      sent: '送信日時',
      status: 'ステータス',
    },
    status: { credited: '完了', requested: '受付済み', sent: '送信済み' },
    footer: {
      questions: 'ご不明な点がありますか？',
      contactSupport: 'サポートに問い合わせる',
      why: 'ウォレット活動のある MYPOKER アカウントにこのアドレスが登録されているため、このメールをお送りしています。',
    },
  },

  ko: {
    deposit: {
      heading: '입금이 반영되었습니다',
      amountLine: '${{amount}} 입금됨',
      note: '지갑에 반영되어 지금 바로 사용할 수 있습니다.',
      subject: '${{amount}} 입금이 반영되었습니다',
    },
    withdrawalRequested: {
      heading: '출금이 요청되었습니다',
      amountLine: '${{amount}} 출금',
      note: '요청을 접수했습니다. 전송되면 다시 이메일로 알려드립니다.',
      subject: '${{amount}} 출금이 요청되었습니다',
    },
    withdrawalSent: {
      heading: '출금이 전송되었습니다',
      amountLine: '${{amount}} 전송됨',
      note: '네트워크로 전송되었습니다. 도착 시점은 승인 수에 따라 달라집니다.',
      subject: '${{amount}} 출금이 전송되었습니다',
    },
    labels: {
      amount: '금액',
      network: '네트워크',
      transaction: '트랜잭션 해시',
      dateTime: '날짜 및 시간',
      toAddress: '받는 TRON 주소',
      requested: '요청 시각',
      sent: '전송 시각',
      status: '상태',
    },
    status: { credited: '완료됨', requested: '요청됨', sent: '전송됨' },
    footer: {
      questions: '문의사항이 있으신가요?',
      contactSupport: '고객지원 문의',
      why: '지갑 활동이 있는 MYPOKER 계정에 이 주소가 등록되어 있어 이 메일을 보내드립니다.',
    },
  },

  th: {
    deposit: {
      heading: 'เติมเงินเข้าบัญชีแล้ว',
      amountLine: 'ได้รับ ${{amount}}',
      note: 'เข้ากระเป๋าเงินของคุณแล้ว และใช้งานได้ทันที',
      subject: 'เติมเงิน ${{amount}} เข้าบัญชีแล้ว',
    },
    withdrawalRequested: {
      heading: 'ส่งคำขอถอนแล้ว',
      amountLine: 'ถอน ${{amount}}',
      note: 'เราได้รับคำขอของคุณแล้ว และจะส่งอีเมลแจ้งอีกครั้งเมื่อโอนออก',
      subject: 'ส่งคำขอถอน ${{amount}} แล้ว',
    },
    withdrawalSent: {
      heading: 'ส่งการถอนแล้ว',
      amountLine: 'ส่ง ${{amount}} แล้ว',
      note: 'ส่งไปยังเครือข่ายแล้ว เวลาที่เงินเข้าขึ้นอยู่กับจำนวนการยืนยัน',
      subject: 'ส่งการถอน ${{amount}} แล้ว',
    },
    labels: {
      amount: 'จำนวน',
      network: 'เครือข่าย',
      transaction: 'แฮชธุรกรรม',
      dateTime: 'วันที่และเวลา',
      toAddress: 'ที่อยู่ TRON ปลายทาง',
      requested: 'เวลาที่ขอ',
      sent: 'เวลาที่ส่ง',
      status: 'สถานะ',
    },
    status: { credited: 'สำเร็จ', requested: 'ขอแล้ว', sent: 'ส่งแล้ว' },
    footer: {
      questions: 'มีคำถามหรือไม่?',
      contactSupport: 'ติดต่อฝ่ายสนับสนุน',
      why: 'คุณได้รับอีเมลนี้เนื่องจากอีเมลนี้ผูกกับบัญชี MYPOKER ที่มีความเคลื่อนไหวของกระเป๋าเงิน',
    },
  },

  vi: {
    deposit: {
      heading: 'Đã nhận khoản nạp',
      amountLine: 'Đã nhận ${{amount}}',
      note: 'Đã ghi có vào ví của bạn và có thể dùng ngay.',
      subject: 'Đã ghi có khoản nạp ${{amount}}',
    },
    withdrawalRequested: {
      heading: 'Đã yêu cầu rút tiền',
      amountLine: 'Rút ${{amount}}',
      note: 'Chúng tôi đã nhận yêu cầu của bạn. Bạn sẽ nhận thêm một email khi tiền được gửi đi.',
      subject: 'Đã yêu cầu rút ${{amount}}',
    },
    withdrawalSent: {
      heading: 'Đã gửi khoản rút',
      amountLine: 'Đã gửi ${{amount}}',
      note: 'Đã phát lên mạng lưới. Thời gian nhận phụ thuộc vào số xác nhận.',
      subject: 'Đã gửi khoản rút ${{amount}}',
    },
    labels: {
      amount: 'Số tiền',
      network: 'Mạng lưới',
      transaction: 'Hash giao dịch',
      dateTime: 'Ngày và giờ',
      toAddress: 'Địa chỉ TRON nhận',
      requested: 'Thời gian yêu cầu',
      sent: 'Thời gian gửi',
      status: 'Trạng thái',
    },
    status: { credited: 'Hoàn tất', requested: 'Đã yêu cầu', sent: 'Đã gửi' },
    footer: {
      questions: 'Có thắc mắc?',
      contactSupport: 'Liên hệ hỗ trợ',
      why: 'Bạn nhận được email này vì địa chỉ này thuộc một tài khoản MYPOKER có hoạt động ví.',
    },
  },

  hi: {
    deposit: {
      heading: 'जमा राशि प्राप्त हुई',
      amountLine: '${{amount}} प्राप्त हुए',
      note: 'आपके वॉलेट में जोड़ दी गई है और अभी उपलब्ध है।',
      subject: '${{amount}} की जमा राशि जोड़ी गई',
    },
    withdrawalRequested: {
      heading: 'निकासी का अनुरोध किया गया',
      amountLine: '${{amount}} की निकासी',
      note: 'हमें आपका अनुरोध मिल गया है। भेजे जाने पर आपको एक और ईमेल मिलेगा।',
      subject: '${{amount}} की निकासी का अनुरोध किया गया',
    },
    withdrawalSent: {
      heading: 'निकासी भेजी गई',
      amountLine: '${{amount}} भेजे गए',
      note: 'नेटवर्क पर प्रसारित कर दी गई है। पहुँचने का समय पुष्टिकरणों पर निर्भर करता है।',
      subject: '${{amount}} की निकासी भेजी गई',
    },
    labels: {
      amount: 'राशि',
      network: 'नेटवर्क',
      transaction: 'ट्रांज़ैक्शन हैश',
      dateTime: 'दिनांक और समय',
      toAddress: 'गंतव्य TRON पता',
      requested: 'अनुरोध का समय',
      sent: 'भेजे जाने का समय',
      status: 'स्थिति',
    },
    status: { credited: 'पूर्ण', requested: 'अनुरोधित', sent: 'भेजा गया' },
    footer: {
      questions: 'कोई प्रश्न?',
      contactSupport: 'सहायता से संपर्क करें',
      why: 'आपको यह ईमेल इसलिए मिला है क्योंकि यह पता वॉलेट गतिविधि वाले MYPOKER खाते से जुड़ा है।',
    },
  },

  id: {
    deposit: {
      heading: 'Setoran diterima',
      amountLine: '${{amount}} diterima',
      note: 'Sudah masuk ke dompet Anda dan tersedia sekarang.',
      subject: 'Setoran ${{amount}} telah masuk',
    },
    withdrawalRequested: {
      heading: 'Penarikan diminta',
      amountLine: 'Penarikan ${{amount}}',
      note: 'Permintaan Anda sudah kami terima. Anda akan menerima email lagi saat dana dikirim.',
      subject: 'Penarikan ${{amount}} telah diminta',
    },
    withdrawalSent: {
      heading: 'Penarikan dikirim',
      amountLine: '${{amount}} dikirim',
      note: 'Sudah disiarkan ke jaringan. Waktu tiba tergantung jumlah konfirmasi.',
      subject: 'Penarikan ${{amount}} telah dikirim',
    },
    labels: {
      amount: 'Jumlah',
      network: 'Jaringan',
      transaction: 'Hash transaksi',
      dateTime: 'Tanggal & waktu',
      toAddress: 'Alamat TRON tujuan',
      requested: 'Waktu permintaan',
      sent: 'Waktu pengiriman',
      status: 'Status',
    },
    status: { credited: 'Selesai', requested: 'Diminta', sent: 'Dikirim' },
    footer: {
      questions: 'Ada pertanyaan?',
      contactSupport: 'Hubungi dukungan',
      why: 'Anda menerima email ini karena alamat ini terdaftar pada akun MYPOKER dengan aktivitas dompet.',
    },
  },
};
