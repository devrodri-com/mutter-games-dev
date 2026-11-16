// src/components/AboutPreview.tsx

export default function AboutPreview() {
  return (
    <section className="bg-[#0F0F0F] py-20 px-6 text-center">
      <div className="max-w-4xl mx-auto">
        <p className="text-xs md:text-sm text-[#FF2D55] uppercase tracking-widest mb-5">
          MUTTER GAMES & COLECCIONABLES
        </p>
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
          Juegos, consolas y coleccionables con historia
        </h2>
        <p className="text-base md:text-lg text-white leading-relaxed">
          Más de 20 años comprando, vendiendo y restaurando.<br />Juegos retro, de última generación y coleccionables, probados y listos para jugar.
        </p>
        <div className="mt-8">
          <a
            href="/about"
            className="inline-block px-6 py-3 bg-[#FF2D55] hover:bg-[#e0264a] text-white text-sm font-semibold rounded-md transition"
          >
            Conocé nuestra historia
          </a>
        </div>
      </div>
    </section>
  );
}