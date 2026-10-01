// src/admin/TiptapEditor.tsx
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';

type Props = {
  content: string;
  onChange: (value: string) => void;
  withDefaultStyles?: boolean;
};

export default function TiptapEditor({
  content,
  onChange,
  withDefaultStyles = false,
}: Props) {
  const editor = useEditor({
    // Preserve the existing HTML schema and keyboard behavior across StarterKit 3.
    extensions: [StarterKit.configure({ link: false, underline: false, trailingNode: false, listKeymap: false }), Underline, TextStyle, Color],
    shouldRerenderOnTransaction: true,
    content,
    editorProps: {
      attributes: {
        class: withDefaultStyles
          ? 'prose max-w-full min-h-[150px] border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-500'
          : '',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 mb-2">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive('bold') ? 'bg-black text-white' : 'bg-gray-200'
          }`}
        >
          Bold
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive('italic') ? 'bg-black text-white' : 'bg-gray-200'
          }`}
        >
          Italic
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive('underline') ? 'bg-black text-white' : 'bg-gray-200'
          }`}
        >
          Underline
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive('heading', { level: 2 }) ? 'bg-black text-white' : 'bg-gray-200'
          }`}
        >
          H2
        </button>
        <input
          type="color"
          onInput={(e) =>
            editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()
          }
          className="w-8 h-8 p-0 border rounded cursor-pointer"
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
