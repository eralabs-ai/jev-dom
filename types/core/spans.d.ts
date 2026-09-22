export declare function tokenize(text: string): string[];

/** Contiguous word runs from the user's own text, shortest first: the words a field may be filled with. */
export declare function spans(text: string, options?: { maxWords?: number; limit?: number }): string[];

/** Digits, number words and phrases ("half dozen", "a couple") the user wrote. */
export declare function numbers(text: string): Array<{ value: number; text: string }>;
