import { File, FileCode2, FileImage, FileJson, FileText, FileArchive, FileTerminal, Folder, FolderOpen, type LucideIcon } from 'lucide-react'

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|cpp|cc|c|h|hpp|cs|go|rs|rb|php|kt|swift|html|css|scss|sql|vue|svelte)$/i
const COLORS: Array<[RegExp, string]> = [
  [/\.(ts|tsx)$/i, '#3178c6'],
  [/\.(js|jsx|mjs|cjs)$/i, '#cbcb41'],
  [/\.py$/i, '#3572a5'],
  [/\.java$/i, '#cc3e44'],
  [/\.(cpp|cc|c|h|hpp)$/i, '#519aba'],
  [/\.json$/i, '#cbcb41'],
  [/\.html?$/i, '#e37933'],
  [/\.(css|scss)$/i, '#519aba'],
  [/\.md$/i, '#519aba'],
  [/\.(png|jpe?g|gif|webp|svg)$/i, '#a074c4'],
  [/\.zip$/i, '#c09553']
]

export function fileIcon(name: string, isDir: boolean, open = false): { Icon: LucideIcon; color?: string } {
  if (isDir) return { Icon: open ? FolderOpen : Folder, color: '#c09553' }
  const color = COLORS.find(([re]) => re.test(name))?.[1]
  if (/\.json$/i.test(name)) return { Icon: FileJson, color }
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name)) return { Icon: FileImage, color }
  if (/\.(zip|tar|gz|7z)$/i.test(name)) return { Icon: FileArchive, color }
  if (/\.(sh|ps1|bat|cmd)$/i.test(name)) return { Icon: FileTerminal, color: '#89e051' }
  if (/\.(md|txt|pdf)$/i.test(name)) return { Icon: FileText, color }
  if (CODE.test(name)) return { Icon: FileCode2, color }
  return { Icon: File }
}

export function FileIcon({ name, isDir = false, open = false, size = 16 }: { name: string; isDir?: boolean; open?: boolean; size?: number }) {
  const { Icon, color } = fileIcon(name, isDir, open)
  return <Icon size={size} strokeWidth={1.6} style={{ color }} className={color ? '' : 'text-muted'} />
}
