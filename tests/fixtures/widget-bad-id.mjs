export const manifest = {
  id: 'wrong-id',
  label: 'Bad ID',
  description: 'Fixture with mismatched manifest id.',
  icon: '<path d="M5 5h14v14H5z"></path>',
  size: 'small',
  dataKeys: [],
  defaults: {},
};

export function render(ctx) {
  ctx.mountNode.textContent = 'bad-id';
  return () => {
    ctx.mountNode.textContent = '';
  };
}
