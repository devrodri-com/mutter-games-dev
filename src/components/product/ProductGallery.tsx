import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import './ProductGallery.css';

interface ProductGalleryProps {
  images: string[] | undefined;
  title: string;
}

/** Native image selection owns no purchase, inventory or platform-specific behavior. */
export default function ProductGallery({ images, title }: ProductGalleryProps) {
  const photos = (images ?? []).filter(source => source.trim().length > 0);
  const [selected, setSelected] = useState(0);
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const thumbnailButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const imageId = useId();
  const index = Math.min(selected, Math.max(0, photos.length - 1));
  const source = photos[index];
  const multiple = photos.length > 1;
  const failed = source !== undefined && failedPhotos.has(source);
  const position = `Foto ${index + 1} de ${photos.length}`;

  function choose(next: number, moveFocus = false) {
    if (next < 0 || next >= photos.length) return;
    setSelected(next);
    if (moveFocus) thumbnailButtons.current[next]?.focus();
  }

  function navigateThumbnails(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1
      : event.key === 'ArrowRight' ? index + 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? photos.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    choose(Math.min(Math.max(next, 0), photos.length - 1), true);
  }

  function retryPhoto() {
    setFailedPhotos(previous => new Set([...previous].filter(failedSource => failedSource !== source)));
    setFailedThumbnails(previous => new Set([...previous].filter(failedSource => failedSource !== source)));
  }

  return <section className={`product-gallery${multiple ? '' : ' product-gallery--single'}`} aria-label={`Fotos de ${title}`}>
    <div className="product-gallery__main">
      <div className="product-gallery__frame" id={imageId}>
        {source === undefined ? <div className="product-gallery__empty">
          <p>No hay fotos disponibles para este producto.</p>
        </div> : failed ? <div className="product-gallery__error">
          <p role="status">No pudimos cargar la foto {index + 1}.</p>
          {multiple && <p>Podés elegir otra foto en las miniaturas.</p>}
          <button type="button" className="product-gallery__retry" onClick={retryPhoto}
            aria-label={`Reintentar carga de la foto ${index + 1}`}>Reintentar</button>
        </div> : <img key={source} className="product-gallery__image" src={source}
          alt={`${title}. ${position}`} draggable={false} decoding="async"
          onError={() => setFailedPhotos(previous => new Set(previous).add(source))} />}
      </div>
      {photos.length > 0 && <div className="product-gallery__navigation">
        {multiple && <button type="button" className="product-gallery__arrow"
          aria-label="Ver foto anterior" aria-controls={imageId} disabled={index === 0}
          onClick={() => choose(index - 1)}><span aria-hidden="true">←</span></button>}
        <p className="product-gallery__position" role="status" aria-live="polite" aria-atomic="true">{position}</p>
        {multiple && <button type="button" className="product-gallery__arrow"
          aria-label="Ver foto siguiente" aria-controls={imageId} disabled={index === photos.length - 1}
          onClick={() => choose(index + 1)}><span aria-hidden="true">→</span></button>}
      </div>}
    </div>
    {multiple && <div className="product-gallery__thumbnails" role="group" aria-label="Elegir foto del producto"
      onKeyDown={navigateThumbnails}>
      {photos.map((photo, photoIndex) => <button key={`${photoIndex}-${photo}`} type="button"
        ref={button => { thumbnailButtons.current[photoIndex] = button; }}
        className="product-gallery__thumbnail" aria-label={`Ver foto ${photoIndex + 1} de ${photos.length}`}
        aria-controls={imageId} aria-pressed={index === photoIndex} aria-current={index === photoIndex ? 'true' : undefined}
        onClick={() => choose(photoIndex)}>
        {failedThumbnails.has(photo) || failedPhotos.has(photo)
          ? <span className="product-gallery__thumbnail-fallback">Foto {photoIndex + 1}</span>
          : <img src={photo} alt="" draggable={false} loading="lazy"
            onError={() => setFailedThumbnails(previous => new Set(previous).add(photo))} />}
      </button>)}
    </div>}
  </section>;
}
