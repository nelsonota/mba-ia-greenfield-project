const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  From: { Address: string };
}

export interface MailpitMessageDetails {
  HTML: string;
}

export async function getMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = (await res.json()) as {
    messages?: MailpitMessageSummary[];
  };
  return data.messages ?? [];
}

export async function getMailpitMessage(
  id: string,
): Promise<MailpitMessageDetails> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return (await res.json()) as MailpitMessageDetails;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
