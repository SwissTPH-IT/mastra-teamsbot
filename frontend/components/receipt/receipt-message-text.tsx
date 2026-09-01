'use client';

import type { FC } from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import { receiptImageUrl, splitReceiptMarkers } from '@/lib/receipt-uploads';

const ReceiptChip: FC<{ filename: string; uploadId: string }> = ({
  filename,
  uploadId,
}) => (
  <a
    href={receiptImageUrl(uploadId)}
    target="_blank"
    rel="noopener noreferrer"
    className="bg-background/70 hover:bg-background flex items-center gap-2 rounded-lg border p-1.5 pe-3 transition-colors"
    title={filename}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={receiptImageUrl(uploadId)}
      alt=""
      className="bg-muted size-9 rounded-md object-cover"
    />
    <span className="max-w-40 truncate text-sm">{filename}</span>
  </a>
);

/**
 * Textteile einer Nutzernachricht. Die Markerzeilen, über die der Agent die
 * uploadIds erfährt, sind technischer Transport – hier werden sie zu einer
 * Bildvorschau. Alles andere bleibt normaler Text.
 */
export const ReceiptMessageText: TextMessagePartComponent = ({ text }) => {
  const { markers, rest } = splitReceiptMarkers(text);

  if (markers.length === 0) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {markers.map(marker => (
          <ReceiptChip key={marker.uploadId} {...marker} />
        ))}
      </div>
      {rest && <p className="whitespace-pre-wrap">{rest}</p>}
    </div>
  );
};
