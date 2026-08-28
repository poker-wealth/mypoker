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
  depositRejected: Event;
  withdrawalRequested: Event;
  withdrawalSent: Event;
  withdrawalConfirmed: Event;
  withdrawalReturned: Event;
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
  status: {
    credited: string;
    requested: string;
    sent: string;
    completed: string;
    returned: string;
    notCredited: string;
  };
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
    depositRejected: {
      heading: 'Deposit not credited',
      amountLine: '${{amount}} not credited',
      note: 'This transfer used a token contract the platform does not accept, so nothing was added to your balance. Contact support with the transaction id below.',
      subject: 'Deposit of ${{amount}} was not credited',
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
    withdrawalConfirmed: {
      heading: 'Withdrawal complete',
      amountLine: '${{amount}} arrived',
      note: 'The transfer is confirmed on the network.',
      subject: 'Withdrawal of ${{amount}} completed',
    },
    withdrawalReturned: {
      heading: 'Withdrawal returned',
      amountLine: '${{amount}} returned',
      note: 'This withdrawal did not go through. The amount is back in your balance and available now.',
      subject: 'Withdrawal of ${{amount}} returned',
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
    status: { credited: 'Completed', requested: 'Requested', sent: 'Sent', completed: 'Completed', returned: 'Returned', notCredited: 'Not credited' },
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
    depositRejected: {
      heading: '充值未到账',
      amountLine: '${{amount}} 未到账',
      note: '此转账使用了平台不接受的代币合约，因此未向您的余额添加任何金额。请携带下方交易 ID 联系客服。',
      subject: '充值 ${{amount}} 未到账',
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
    withdrawalConfirmed: {
      heading: '提现已完成',
      amountLine: '${{amount}} 已到账',
      note: '该转账已在网络上确认。',
      subject: '提现 ${{amount}} 已完成',
    },
    withdrawalReturned: {
      heading: '提现已退回',
      amountLine: '${{amount}} 已退回',
      note: '此次提现未能完成，金额已退回您的余额，现在即可使用。',
      subject: '提现 ${{amount}} 已退回',
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
    status: { credited: '已完成', requested: '已申请', sent: '已发出', completed: '已完成', returned: '已退回', notCredited: '未到账' },
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
    depositRejected: {
      heading: '入金は反映されませんでした',
      amountLine: '${{amount}} は反映されていません',
      note: 'この送金はプラットフォームが受け付けていないトークンコントラクトを使用しているため、残高には追加されていません。下記のトランザクション ID を添えてサポートにご連絡ください。',
      subject: '${{amount}} の入金は反映されませんでした',
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
    withdrawalConfirmed: {
      heading: '出金が完了しました',
      amountLine: '${{amount}} が着金しました',
      note: 'ネットワーク上で承認されました。',
      subject: '${{amount}} の出金が完了しました',
    },
    withdrawalReturned: {
      heading: '出金が返金されました',
      amountLine: '${{amount}} を返金しました',
      note: 'この出金は完了せず、金額は残高に戻りました。すぐにご利用いただけます。',
      subject: '${{amount}} の出金が返金されました',
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
    status: { credited: '完了', requested: '受付済み', sent: '送信済み', completed: '完了', returned: '返金済み', notCredited: '未反映' },
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
    depositRejected: {
      heading: '입금이 반영되지 않았습니다',
      amountLine: '${{amount}} 미반영',
      note: '이 전송은 플랫폼이 허용하지 않는 토큰 컨트랙트를 사용했기 때문에 잔액에 추가되지 않았습니다. 아래 트랜잭션 ID와 함께 고객지원에 문의해 주세요.',
      subject: '${{amount}} 입금이 반영되지 않았습니다',
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
    withdrawalConfirmed: {
      heading: '출금이 완료되었습니다',
      amountLine: '${{amount}} 도착',
      note: '네트워크에서 승인되었습니다.',
      subject: '${{amount}} 출금이 완료되었습니다',
    },
    withdrawalReturned: {
      heading: '출금이 반환되었습니다',
      amountLine: '${{amount}} 반환됨',
      note: '이 출금은 완료되지 않았으며 금액은 잔액으로 돌아와 지금 사용할 수 있습니다.',
      subject: '${{amount}} 출금이 반환되었습니다',
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
    status: { credited: '완료됨', requested: '요청됨', sent: '전송됨', completed: '완료됨', returned: '반환됨', notCredited: '미반영' },
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
    depositRejected: {
      heading: 'ไม่ได้เติมเงินเข้าบัญชี',
      amountLine: '${{amount}} ไม่ถูกเติมเข้าบัญชี',
      note: 'การโอนนี้ใช้สัญญาโทเคนที่แพลตฟอร์มไม่รองรับ จึงไม่มีการเพิ่มยอดเงินในบัญชีของคุณ กรุณาติดต่อฝ่ายสนับสนุนพร้อมรหัสธุรกรรมด้านล่าง',
      subject: 'ไม่ได้เติมเงิน ${{amount}} เข้าบัญชี',
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
    withdrawalConfirmed: {
      heading: 'ถอนเงินสำเร็จ',
      amountLine: '${{amount}} เข้าบัญชีแล้ว',
      note: 'ธุรกรรมได้รับการยืนยันบนเครือข่ายแล้ว',
      subject: 'ถอนเงิน ${{amount}} สำเร็จ',
    },
    withdrawalReturned: {
      heading: 'คืนเงินการถอนแล้ว',
      amountLine: 'คืน ${{amount}} แล้ว',
      note: 'การถอนนี้ไม่สำเร็จ ยอดเงินกลับเข้าบัญชีของคุณแล้วและใช้งานได้ทันที',
      subject: 'คืนเงินการถอน ${{amount}} แล้ว',
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
    status: { credited: 'สำเร็จ', requested: 'ขอแล้ว', sent: 'ส่งแล้ว', completed: 'สำเร็จ', returned: 'คืนเงินแล้ว', notCredited: 'ไม่ได้เติมเข้าบัญชี' },
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
    depositRejected: {
      heading: 'Khoản nạp không được ghi có',
      amountLine: '${{amount}} không được ghi có',
      note: 'Giao dịch này dùng hợp đồng token mà nền tảng không chấp nhận, nên không có khoản nào được cộng vào số dư của bạn. Vui lòng liên hệ hỗ trợ kèm mã giao dịch bên dưới.',
      subject: 'Khoản nạp ${{amount}} không được ghi có',
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
    withdrawalConfirmed: {
      heading: 'Rút tiền hoàn tất',
      amountLine: '${{amount}} đã đến nơi',
      note: 'Giao dịch đã được xác nhận trên mạng lưới.',
      subject: 'Rút ${{amount}} đã hoàn tất',
    },
    withdrawalReturned: {
      heading: 'Khoản rút đã hoàn lại',
      amountLine: 'Đã hoàn lại ${{amount}}',
      note: 'Lệnh rút này không thành công. Số tiền đã trở lại số dư của bạn và có thể dùng ngay.',
      subject: 'Khoản rút ${{amount}} đã hoàn lại',
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
    status: { credited: 'Hoàn tất', requested: 'Đã yêu cầu', sent: 'Đã gửi', completed: 'Hoàn tất', returned: 'Đã hoàn lại', notCredited: 'Không được ghi có' },
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
    depositRejected: {
      heading: 'जमा राशि जोड़ी नहीं गई',
      amountLine: '${{amount}} जोड़ी नहीं गई',
      note: 'इस ट्रांसफ़र में ऐसा टोकन कॉन्ट्रैक्ट इस्तेमाल हुआ जिसे प्लेटफ़ॉर्म स्वीकार नहीं करता, इसलिए आपके बैलेंस में कुछ नहीं जोड़ा गया। नीचे दिए ट्रांज़ैक्शन ID के साथ सहायता से संपर्क करें।',
      subject: '${{amount}} की जमा राशि जोड़ी नहीं गई',
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
    withdrawalConfirmed: {
      heading: 'निकासी पूर्ण',
      amountLine: '${{amount}} पहुँच गए',
      note: 'यह ट्रांसफ़र नेटवर्क पर पुष्ट हो गया है।',
      subject: '${{amount}} की निकासी पूर्ण हुई',
    },
    withdrawalReturned: {
      heading: 'निकासी वापस की गई',
      amountLine: '${{amount}} वापस किए गए',
      note: 'यह निकासी पूरी नहीं हुई। राशि आपके बैलेंस में वापस आ गई है और अभी उपलब्ध है।',
      subject: '${{amount}} की निकासी वापस की गई',
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
    status: { credited: 'पूर्ण', requested: 'अनुरोधित', sent: 'भेजा गया', completed: 'पूर्ण', returned: 'वापस किया गया', notCredited: 'जोड़ी नहीं गई' },
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
    depositRejected: {
      heading: 'Setoran tidak masuk',
      amountLine: '${{amount}} tidak masuk',
      note: 'Transfer ini memakai kontrak token yang tidak diterima platform, jadi tidak ada yang ditambahkan ke saldo Anda. Hubungi dukungan dengan ID transaksi di bawah.',
      subject: 'Setoran ${{amount}} tidak masuk',
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
    withdrawalConfirmed: {
      heading: 'Penarikan selesai',
      amountLine: '${{amount}} telah tiba',
      note: 'Transaksi sudah dikonfirmasi di jaringan.',
      subject: 'Penarikan ${{amount}} selesai',
    },
    withdrawalReturned: {
      heading: 'Penarikan dikembalikan',
      amountLine: '${{amount}} dikembalikan',
      note: 'Penarikan ini tidak berhasil. Jumlahnya sudah kembali ke saldo Anda dan tersedia sekarang.',
      subject: 'Penarikan ${{amount}} dikembalikan',
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
    status: { credited: 'Selesai', requested: 'Diminta', sent: 'Dikirim', completed: 'Selesai', returned: 'Dikembalikan', notCredited: 'Tidak masuk' },
    footer: {
      questions: 'Ada pertanyaan?',
      contactSupport: 'Hubungi dukungan',
      why: 'Anda menerima email ini karena alamat ini terdaftar pada akun MYPOKER dengan aktivitas dompet.',
    },
  },
};
