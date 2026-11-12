"use client";

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
}) {
  return (
    <nav aria-label="Categorias do cardápio" className="category-list">
      {["Todos", ...categories].map((category) => (
        <button
          aria-pressed={selected === category}
          className={`category-chip${selected === category ? " selected" : ""}`}
          key={category}
          onClick={() => onSelect(category)}
          type="button"
        >
          {category}
        </button>
      ))}
    </nav>
  );
}
