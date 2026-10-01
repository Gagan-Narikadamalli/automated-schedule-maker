import nodemailer from "nodemailer";

function getGmailConfiguration(): {
  user: string;
  appPassword: string;
} {
  const user = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!user || !appPassword) {
    throw new Error(
      "GMAIL_USER and GMAIL_APP_PASSWORD must be configured before email OTP login can be used."
    );
  }

  return {
    user,
    appPassword,
  };
}

export async function sendLoginOtpEmail(
  destinationEmail: string,
  oneTimeCode: string
): Promise<void> {
  const gmail = getGmailConfiguration();

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmail.user,
      pass: gmail.appPassword,
    },
  });

  await transporter.sendMail({
    from: `SOS Schedule Maker <${gmail.user}>`,
    to: destinationEmail,
    subject: "Your SOS Schedule Maker verification code",
    text: [
      "Your SOS Schedule Maker verification code is:",
      "",
      oneTimeCode,
      "",
      "This code expires in 10 minutes.",
      "If you did not try to sign in, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #173042; line-height: 1.5;">
        <h2 style="color: #123b5d;">SOS Schedule Maker</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${oneTimeCode}</p>
        <p>This code expires in 10 minutes.</p>
        <p>If you did not try to sign in, you can ignore this email.</p>
      </div>
    `,
  });
}
