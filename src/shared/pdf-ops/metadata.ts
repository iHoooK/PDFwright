import { PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument } from 'pdf-lib'
import { load, PRODUCER } from './document'

/**
 * Метаданные документа: словарь Info и XMP-поток каталога (/Metadata).
 * Adobe Reader показывает XMP, если он есть, поэтому при записи Info старый
 * XMP заменяется новым с теми же значениями, а не остаётся противоречить им.
 */
export interface DocumentMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
}

export const METADATA_FIELDS: readonly (keyof DocumentMetadata)[] = [
  'title',
  'author',
  'subject',
  'keywords',
  'creator'
]

const INFO_KEYS: Record<keyof DocumentMetadata, string> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator'
}

function infoDict(doc: PDFDocument, create: boolean): PDFDict | null {
  const existing = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  if (existing || !create) return existing ?? null
  const dict = doc.context.obj({})
  doc.context.trailerInfo.Info = doc.context.register(dict)
  return dict
}

function readInfo(dict: PDFDict | null, key: string): string {
  const value = dict?.lookup(PDFName.of(key))
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText().trim()
    : ''
}

export async function readMetadata(bytes: Uint8Array): Promise<DocumentMetadata> {
  const dict = infoDict(await load(bytes), false)
  const meta = {} as DocumentMetadata
  for (const field of METADATA_FIELDS) meta[field] = readInfo(dict, INFO_KEYS[field])
  return meta
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function xmpPacket(meta: DocumentMetadata, modified: Date): string {
  const alt = (tag: string, value: string): string =>
    value
      ? `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${tag}>`
      : ''
  const simple = (tag: string, value: string): string =>
    value ? `<${tag}>${escapeXml(value)}</${tag}>` : ''
  const creator = meta.author
    ? `<dc:creator><rdf:Seq><rdf:li>${escapeXml(meta.author)}</rdf:li></rdf:Seq></dc:creator>`
    : ''
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    '<dc:format>application/pdf</dc:format>',
    alt('dc:title', meta.title),
    creator,
    alt('dc:description', meta.subject),
    simple('pdf:Keywords', meta.keywords),
    simple('pdf:Producer', PRODUCER),
    simple('xmp:CreatorTool', meta.creator),
    simple('xmp:ModifyDate', modified.toISOString()),
    simple('xmp:MetadataDate', modified.toISOString()),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>'
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * Записывает поля метаданных; пустая строка удаляет поле. Producer и дата
 * изменения обновляются, дата создания остаётся прежней.
 */
export async function writeMetadata(
  bytes: Uint8Array,
  patch: Partial<DocumentMetadata>
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const dict = infoDict(doc, true)
  if (!dict) throw new Error('Словарь Info не создан')
  for (const field of METADATA_FIELDS) {
    const value = patch[field]
    if (value === undefined) continue
    const key = PDFName.of(INFO_KEYS[field])
    const text = value.trim()
    if (text.length === 0) dict.delete(key)
    else dict.set(key, PDFHexString.fromText(text))
  }
  const modified = new Date()
  doc.setProducer(PRODUCER)
  doc.setModificationDate(modified)
  if (doc.catalog.has(PDFName.of('Metadata'))) {
    const meta = {} as DocumentMetadata
    for (const field of METADATA_FIELDS) meta[field] = readInfo(dict, INFO_KEYS[field])
    const xmp = doc.context.stream(new TextEncoder().encode(xmpPacket(meta, modified)), {
      Type: 'Metadata',
      Subtype: 'XML'
    })
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp))
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false })
}

/**
 * Удаляет все метаданные: словарь Info целиком и XMP каталога (у страниц
 * и картинок свои XMP-потоки не трогаем — это часть содержимого).
 */
export async function clearMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes)
  const info = doc.context.trailerInfo.Info
  if (info instanceof PDFRef) doc.context.delete(info)
  delete doc.context.trailerInfo.Info
  const xmp = doc.catalog.get(PDFName.of('Metadata'))
  doc.catalog.delete(PDFName.of('Metadata'))
  if (xmp instanceof PDFRef) doc.context.delete(xmp)
  // Без setProducer: pdf-lib с updateMetadata: false сам Info не создаёт.
  return doc.save({ useObjectStreams: true, addDefaultPage: false })
}
