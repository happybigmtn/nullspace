import React from 'react';
import renderer from 'react-test-renderer';
import { Text } from 'react-native';
import { Card, HiddenCard } from '../Card';

describe('Card', () => {
  it('renders rank and suit when face up', () => {
    const tree = renderer.create(
      <Card suit="hearts" rank="A" faceUp />
    );
    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain('A');
    expect(texts).toContain('♥');
  });

  it('renders hidden card placeholder', () => {
    const tree = renderer.create(<HiddenCard />);
    expect(tree.toJSON()).toBeTruthy();
  });
});
