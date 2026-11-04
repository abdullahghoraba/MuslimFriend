import { Pipe, PipeTransform } from '@angular/core';
import { intlLocale } from '../core/models';

/**
 * Date and time in the reader's language with Intl (Angular's DatePipe needs each locale's data registered and
 * throws for the app's other languages): {{ ts | localDate: lang() }}.
 */
@Pipe({ name: 'localDate' })
export class LocalDatePipe implements PipeTransform {
  transform(value: number | Date | null | undefined, lang: string): string {
    if (value === null || value === undefined) return '';
    try {
      return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(value);
    } catch {
      return new Date(value).toLocaleString();
    }
  }
}
