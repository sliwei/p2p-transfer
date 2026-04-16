import { getEffectiveDropFileSize } from './app-drop-protocol'

/** 与原生 MALIAN_DROP_MAX_MULTI_COUNT 一致 */
export const MAX_SELECTED_FILES = 100

/** 与原生 MALIAN_DROP_MAX_FILE_BYTES 一致（如 20MB） */
export const MAX_SINGLE_FILE_BYTES = 2000 * 1024 * 1024

export function sumSelectedFilesBytes(files: File[]): number {
  return files.reduce((s, f) => s + getEffectiveDropFileSize(f), 0)
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return /^(mp4|mov|webm|mkv|avi|m4v|3gp|ogv)$/i.test(ext)
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return /^(jpe?g|png|gif|webp|heic|heif|bmp|svg|avif|tiff?)$/i.test(ext)
}

export function isImageOrVideo(file: File): boolean {
  return isImageFile(file) || isVideoFile(file)
}

export type MergeIntoSelectedFilesResult = {
  next: File[]
  oversizedNames: string[]
  /** 单次选择超过 10 个有效项时截断的数量 */
  droppedFromBatchLimit: number
  /** 因列表剩余槽位不足而未加入的数量 */
  droppedFromListCap: number
  /** 列表已满时仍尝试添加 */
  blockedBecauseFull: boolean
}

export function mergeIntoSelectedFiles(prev: File[], incoming: File[], isAllowedType: (f: File) => boolean): MergeIntoSelectedFilesResult {
  const typed = incoming.filter(isAllowedType)
  const oversizedNames: string[] = []
  const okSize: File[] = []
  for (const f of typed) {
    if (getEffectiveDropFileSize(f) >= MAX_SINGLE_FILE_BYTES) oversizedNames.push(f.name)
    else okSize.push(f)
  }

  const batchCapped = okSize.slice(0, MAX_SELECTED_FILES)
  const droppedFromBatchLimit = okSize.length - batchCapped.length

  if (prev.length >= MAX_SELECTED_FILES) {
    return {
      next: prev,
      oversizedNames,
      droppedFromBatchLimit,
      droppedFromListCap: 0,
      blockedBecauseFull: typed.length > 0
    }
  }

  const slots = MAX_SELECTED_FILES - prev.length
  const toAdd: File[] = []
  let droppedFromListCap = 0

  for (const f of batchCapped) {
    if (toAdd.length >= slots) {
      droppedFromListCap++
      continue
    }
    toAdd.push(f)
  }

  return {
    next: toAdd.length > 0 ? [...prev, ...toAdd] : prev,
    oversizedNames,
    droppedFromBatchLimit,
    droppedFromListCap,
    blockedBecauseFull: false
  }
}

export function mergeFeedbackMessage(r: MergeIntoSelectedFilesResult): string | null {
  const parts: string[] = []
  if (r.blockedBecauseFull) {
    parts.push(`已达上限（最多 ${MAX_SELECTED_FILES} 个文件），无法继续添加`)
  }
  if (r.oversizedNames.length > 0) {
    const sample = r.oversizedNames.slice(0, 3).join('、')
    const more = r.oversizedNames.length > 3 ? ` 等 ${r.oversizedNames.length} 个` : ''
    parts.push(`以下文件达到或超过 ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB，已跳过：${sample}${more}`)
  }
  if (r.droppedFromBatchLimit > 0) {
    parts.push(`单次最多选择 ${MAX_SELECTED_FILES} 个文件，已忽略多余 ${r.droppedFromBatchLimit} 个`)
  }
  if (r.droppedFromListCap > 0) {
    parts.push(`列表最多 ${MAX_SELECTED_FILES} 个文件，${r.droppedFromListCap} 个未加入`)
  }
  if (parts.length === 0) return null
  return parts.join('\n')
}
