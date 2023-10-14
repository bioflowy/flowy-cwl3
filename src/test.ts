class A {
  a: string;
}
class B extends A {
  b: string;
}
class C {
  c: string;
}
class D extends C {
  d: string;
}

type Parent = A | C;

type Child = B | D;

interface ParentClass<T extends Parent> {
  T;
}

interface ChildClass extends ParentClass<Child> {}
