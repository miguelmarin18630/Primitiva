/**
 * Entrada de producción: activa el modo estático antes de cargar el servidor.
 * Se usa un import dinámico porque las importaciones estáticas se ejecutan antes
 * de cualquier asignación a process.env.
 */
process.env.NODE_ENV = 'production';

await import('./server.ts');
